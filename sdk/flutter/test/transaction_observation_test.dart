import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';
// The SHA-256 helper is an internal detail of the SDK, not public API. The
// test uses it to prove the SDK's digest agrees with the shared vectors.
import 'package:mosaic_sdk/src/sha256.dart';

import 'support/canonical_fixture.dart';

/// A stable namespace: the runtime rejects anything that is not a SHA-256 hex
/// digest, so tests derive one the same way the SDK does.
const String _providerId = 'fixture-provider-apple';

final String _namespace = mosaicTransactionObservationNamespace(
  Uri.parse('https://api.mosaic.test'),
  'public_sdk_key_test',
);

/// The digest an Android adapter computes for the canonical fixture token. It
/// is read from the shared cross-SDK vectors rather than hard coded, so a
/// change to the derivation contract fails here instead of silently diverging.
Map<String, Object?> _vectors() => jsonDecode(
      repositoryFile(
              'packages/test-fixtures/src/billing-reference-vectors.json')
          .readAsStringSync(),
    ) as Map<String, Object?>;

void main() {
  group('customer token binding', _customerTokenBindingTests);

  // Purpose: a purchase observed on both production paths must reach the
  // ingestion endpoint exactly once, and must survive an app kill. Without
  // this, the two sources double-submit and a purchase completed just before
  // termination is lost. Nothing else in the SDK persists this record.
  group('durable duplicate-safe queue', () {
    test('one purchase seen twice queues once and survives a restart',
        () async {
      final storage = MosaicMemoryTransactionObservationStorage();
      // Delivery never finishes, so the record is still queued when the app is
      // killed. That is the case the persisted queue exists for.
      final runtime =
          _runtime(storage: storage, transport: _StalledTransport());

      // The renderer path and the provider-update path, in either order. The
      // iOS adapter's local prefix and the raw wire value are one transaction.
      expect(
          await runtime.observe(
              providerId: _providerId,
              transactionReference: 'storekit_2000000900000001'),
          isTrue);
      expect(
          await runtime.observe(
              providerId: _providerId,
              transactionReference: '2000000900000001'),
          isFalse);
      var diagnostics = await runtime.diagnostics();
      expect(diagnostics.queued, 1);
      expect(diagnostics.deduplicated, 1);
      expect(storage.source, isNotNull);

      // A new runtime over the same storage is the app-restart case.
      final transport = _RecordingTransport();
      final restored = _runtime(storage: storage, transport: transport);
      diagnostics = await restored.diagnostics();
      expect(diagnostics.queued, 1);

      final result = await restored.flush();
      expect(result, isA<MosaicTransactionObservationFlushCompleted>());
      expect(transport.submitted, hasLength(1));
      expect((await restored.diagnostics()).queued, isZero);

      // The acknowledged key is remembered, so a later re-observation of the
      // same transaction never produces a second submission.
      expect(
          await restored.observe(
              providerId: _providerId,
              transactionReference: '2000000900000001'),
          isFalse);
      expect(transport.submitted, hasLength(1));
    });

    test('a stable submission identifier is reused on every attempt', () async {
      final storage = MosaicMemoryTransactionObservationStorage();
      final transport =
          _ScriptedTransport(<MosaicTransactionObservationSubmission>[
        const MosaicTransactionObservationRetryableFailure(
          safeCode: 'rate_limited',
          retryAfter: Duration.zero,
        ),
        const MosaicTransactionObservationDuplicate(
          submissionId: 'placeholder',
        ),
      ]);
      final runtime = _runtime(storage: storage, transport: transport);
      await runtime.observe(
          providerId: _providerId, transactionReference: '2000000900000001');
      await runtime.flush();
      await runtime.flush();
      expect(transport.submissionIds, hasLength(2));
      expect(transport.submissionIds.first, transport.submissionIds.last);
    });
  });

  // Purpose: the SDK must not storm a public endpoint, must drain a document
  // the server can never accept, and must never expose a member that reads as
  // "validated". Both are irrecoverable in production once shipped.
  group('submission classification and retry policy', () {
    test('each outcome moves the record the way the contract requires',
        () async {
      for (final scenario in <({
        MosaicTransactionObservationSubmission result,
        int queued,
        String? safeCode,
      })>[
        (
          result: const MosaicTransactionObservationAcceptedForValidation(
            submissionId: 'placeholder',
          ),
          queued: 0,
          safeCode: null,
        ),
        (
          result: const MosaicTransactionObservationDuplicate(
              submissionId: 'placeholder'),
          queued: 0,
          safeCode: null,
        ),
        (
          result: const MosaicTransactionObservationPermanentlyRejected(
            submissionId: 'placeholder',
            safeCode: 'billing_not_enabled',
          ),
          queued: 0,
          safeCode: 'billing_not_enabled',
        ),
        (
          result: const MosaicTransactionObservationRetryableFailure(
            safeCode: 'rate_limited',
            retryAfter: Duration(seconds: 30),
          ),
          queued: 1,
          safeCode: 'rate_limited',
        ),
      ]) {
        final runtime = _runtime(
          storage: MosaicMemoryTransactionObservationStorage(),
          transport:
              _ScriptedTransport(<MosaicTransactionObservationSubmission>[
            scenario.result,
          ]),
        );
        await runtime.observe(
            providerId: _providerId, transactionReference: '2000000900000001');
        await runtime.flush();
        final diagnostics = await runtime.diagnostics();
        expect(diagnostics.queued, scenario.queued,
            reason: '${scenario.result.runtimeType}');
        if (scenario.safeCode != null) {
          expect(diagnostics.lastSafeCode, scenario.safeCode);
        }
      }
    });

    test('retries are bounded and the record is finally dropped', () async {
      final transport = _AlwaysRetryableTransport();
      final runtime = _runtime(
        storage: MosaicMemoryTransactionObservationStorage(),
        transport: transport,
      );
      await runtime.observe(
          providerId: _providerId, transactionReference: '2000000900000001');
      for (var attempt = 0;
          attempt < mosaicTransactionObservationMaximumAttempts + 2;
          attempt++) {
        await runtime.flush();
      }
      final diagnostics = await runtime.diagnostics();
      expect(diagnostics.queued, isZero);
      expect(diagnostics.attemptsExhausted, 1);
      expect(
        transport.calls,
        lessThanOrEqualTo(mosaicTransactionObservationMaximumAttempts),
      );
    });

    test('canonical submission-response fixtures decode to their outcome', () {
      MosaicTransactionObservationSubmission decodeFixture(String name) =>
          MosaicIoTransactionObservationTransport.decodeSubmission(
            statusCode: 202,
            body: repositoryFile(
              'protocol/fixtures/billing-ingestion/v1/responses/$name.json',
            ).readAsStringSync(),
            submissionId: 'observation_test',
          );

      final accepted = decodeFixture('accepted-for-validation');
      expect(
          accepted, isA<MosaicTransactionObservationAcceptedForValidation>());
      expect(
        (accepted as MosaicTransactionObservationAcceptedForValidation)
            .submissionId,
        'fixture-submission-apple-0001',
      );
      expect(decodeFixture('duplicate-observation'),
          isA<MosaicTransactionObservationDuplicate>());

      final rejected = decodeFixture('permanent-rejection');
      expect(rejected, isA<MosaicTransactionObservationPermanentlyRejected>());
      expect(
        (rejected as MosaicTransactionObservationPermanentlyRejected).safeCode,
        'provider_reference_malformed',
      );

      final retryable = decodeFixture('retryable-failure');
      expect(retryable, isA<MosaicTransactionObservationRetryableFailure>());
      final failure = retryable as MosaicTransactionObservationRetryableFailure;
      expect(failure.safeCode, 'rate_limited');
      // The contract's body field carries the backoff, not only the header.
      expect(failure.retryAfter, const Duration(seconds: 30));
    });

    test('undecodable and unexpected answers are retried, never guessed at',
        () {
      MosaicTransactionObservationSubmission decode(
        int status,
        String body, {
        String? retryAfter,
      }) =>
          MosaicIoTransactionObservationTransport.decodeSubmission(
            statusCode: status,
            body: body,
            submissionId: 'observation_test',
            retryAfterHeader: retryAfter,
          );

      const envelope =
          '"billingIngestionContractVersion":"1","recordType":"observationSubmissionResult"';
      for (final body in <String>[
        '',
        'not json',
        '[]',
        // The {"data":{...}} shape is not the contract record.
        '{"data":{"submissionId":"observation_test","outcome":"duplicate"}}',
        // A future contract version is never read as version 1.
        '{"billingIngestionContractVersion":"2","recordType":"observationSubmissionResult","payload":{"submissionId":"observation_test","status":"duplicate"}}',
        '{$envelope,"payload":{"submissionId":"observation_test","status":"validated"}}',
        '{$envelope,"payload":{"status":"duplicate"}}',
      ]) {
        expect(decode(202, body),
            isA<MosaicTransactionObservationRetryableFailure>(),
            reason: body);
      }

      // Transport-level answers keep their own classification.
      final throttled = decode(429, '', retryAfter: '30');
      expect(throttled, isA<MosaicTransactionObservationRetryableFailure>());
      expect(
        (throttled as MosaicTransactionObservationRetryableFailure).retryAfter,
        const Duration(seconds: 30),
      );
      expect(
          decode(503, ''), isA<MosaicTransactionObservationRetryableFailure>());
      // A rejected document cannot succeed by being resent unchanged.
      expect(decode(422, ''),
          isA<MosaicTransactionObservationPermanentlyRejected>());
    });

    test('no declaration in the subsystem can express a validated transaction',
        () {
      for (final path in <String>[
        'sdk/flutter/lib/src/transaction_observation.dart',
        'sdk/flutter/lib/src/transaction_observation_transport.dart',
      ]) {
        // Comments may discuss the rule; declarations may not embody it.
        final code = repositoryFile(path)
            .readAsLinesSync()
            .where((line) => !line.trimLeft().startsWith('//'))
            .join('\n')
            .toLowerCase()
            // The only honest acceptance spelling in the contract.
            .replaceAll('acceptedforvalidation', '')
            .replaceAll('accepted_for_validation', '')
            .replaceAll('forvalidation', '');
        for (final word in <String>[
          'validated',
          'verified',
          'confirmed',
          'entitled',
        ]) {
          expect(code.contains(word), isFalse, reason: '$path leaks "$word"');
        }
      }
    });
  });

  // Purpose: billing-adjacent data must not be collected without consent, and
  // withdrawing consent must not leave records on disk for a later flush.
  test('disabling collection clears the queue and the persisted document',
      () async {
    final storage = MosaicMemoryTransactionObservationStorage();
    final transport = _RecordingTransport();
    final runtime = _runtime(storage: storage, transport: transport);
    await runtime.observe(
        providerId: _providerId, transactionReference: '2000000900000001');
    expect(storage.source, isNotNull);

    await runtime.setCollection(hostEnabled: false);
    expect(storage.source, isNull);
    var diagnostics = await runtime.diagnostics();
    expect(diagnostics.enabled, isFalse);
    expect(diagnostics.queued, isZero);
    expect(await runtime.flush(),
        isA<MosaicTransactionObservationFlushDisabled>());

    // Nothing is observed while collection is off, and re-enabling never
    // resurrects a cleared record.
    await runtime.observe(
        providerId: _providerId, transactionReference: '2000000900000002');
    await runtime.setCollection(hostEnabled: true);
    diagnostics = await runtime.diagnostics();
    expect(diagnostics.enabled, isTrue);
    expect(diagnostics.queued, isZero);
    expect(transport.submitted, isEmpty);

    // A runtime constructed with the opt-in absent is never able to collect.
    final off = _runtime(
      storage: MosaicMemoryTransactionObservationStorage(),
      transport: transport,
      settings: const MosaicTransactionObservationSettings(hostEnabled: false),
    );
    await off.observe(
        providerId: _providerId, transactionReference: '2000000900000001');
    expect((await off.diagnostics()).queued, isZero);
  });

  // Purpose: the worst outcome of this feature is a provider credential
  // leaving the device. Rejection must be structural, not advisory.
  group('reference sanitization', () {
    test('credential-shaped and placeholder references are refused', () async {
      final storage = MosaicMemoryTransactionObservationStorage();
      final transport = _RecordingTransport();
      final runtime = _runtime(storage: storage, transport: transport);
      final jws = 'eyJhbGciOiJFUzI1NiJ9.${'a' * 900}.${'b' * 86}';
      final rejected = <String>[
        '',
        '   ',
        jws,
        // A raw Google Play purchase token is far longer than the bound.
        'a' * 129,
        'mock-mosaic_pro_yearly',
        'preview-yearly-plan',
        // A control character can never reach the wire.
        '2000000900000001${String.fromCharCode(1)}',
        '2000000900000001 extra',
        'storekit_not-a-number',
        // An Apple record may never carry a Play digest, and vice versa.
        'ecdb16b8fb3378895aeb12223bc53edc67ac874ac2ea15c01e15c897af2c2478',
      ];
      for (final value in rejected) {
        expect(
            await runtime.observe(
                providerId: _providerId, transactionReference: value),
            isFalse,
            reason: value);
      }
      // A provider that reports no reference is ordinary, not a rejection.
      expect(
          await runtime.observe(
              providerId: _providerId, transactionReference: null),
          isFalse);

      expect(transport.submitted, isEmpty);
      final diagnostics = await runtime.diagnostics();
      expect(diagnostics.queued, isZero);
      expect(diagnostics.rejectedReferences, rejected.length);
      expect(diagnostics.lastSafeCode,
          mosaicTransactionObservationReferenceRejectedCode);
    });

    test('shared cross-SDK vectors are carried verbatim as strings', () async {
      final vectors = _vectors();
      final apple = (vectors['appStoreTransactionId']! as Map)['vectors']!
          as List<Object?>;
      for (final entry in apple.cast<Map<String, Object?>>()) {
        final value = entry['value']! as String;
        final runtime = _runtime(
          storage: MosaicMemoryTransactionObservationStorage(),
          transport: _RecordingTransport(),
        );
        expect(
            await runtime.observe(
                providerId: _providerId, transactionReference: value),
            isTrue,
            reason: entry['id'] as String?);
        final reference =
            MosaicTransactionReference.appStoreTransactionId(value);
        // UInt64.max and 2^53+1 must survive without ever becoming a number.
        expect(reference.value, value);
        expect(reference.kind.wireValue, 'app_store_transaction_id');
        // The iOS adapter's local prefix is stripped at this boundary only.
        expect(
          MosaicTransactionReference.appStoreTransactionId('storekit_$value')
              .value,
          value,
        );
      }

      final google = (vectors['googlePlayTokenDigest']! as Map)['vectors']!
          as List<Object?>;
      for (final entry in google.cast<Map<String, Object?>>()) {
        final token = entry['token']! as String;
        final digest = entry['digest']! as String;
        // The SDK's own SHA-256 must agree with the derivation the Android
        // adapter performs, including for the non-ASCII UTF-8 vector.
        expect(mosaicSha256String(token), digest,
            reason: entry['id'] as String?);
        final runtime = _runtime(
          storage: MosaicMemoryTransactionObservationStorage(),
          transport: _RecordingTransport(),
          storePlatform: MosaicStorePlatform.android,
        );
        expect(
            await runtime.observe(
                providerId: _providerId, transactionReference: digest),
            isTrue);
        // The raw token itself is never a submittable reference.
        expect(
            await runtime.observe(
                providerId: _providerId, transactionReference: token),
            isFalse);
      }
    });

    test('serialization matches the canonical client observation fixtures',
        () async {
      // A canonical fixture is reproduced exactly except for the three values
      // this SDK legitimately authors itself: the two identifiers it generates,
      // and sdkFamily, which is always "flutter" here. Everything else — the
      // envelope, record type, provider, store platform, reference and order
      // reference shapes, source authority, context keys, correlation, claimed
      // Product, and timestamp format — must match byte for byte.
      for (final name in <String>[
        'apple-client-observation',
        'google-client-observation',
      ]) {
        final fixture = jsonDecode(
          repositoryFile(
            'protocol/fixtures/billing-ingestion/v1/$name.json',
          ).readAsStringSync(),
        ) as Map<String, Object?>;
        final expected = (fixture['payload']! as Map).cast<String, Object?>();
        final reference =
            (expected['transactionReference']! as Map).cast<String, Object?>();
        final order = expected['providerOrderReference'] as Map?;
        final context = (expected['context']! as Map).cast<String, Object?>();
        final correlation = expected['correlation'] as Map?;
        final storePlatform =
            mosaicStorePlatformFromWireValue(expected['storePlatform'])!;

        final observation = MosaicTransactionObservation(
          providerId: expected['providerId']! as String,
          storePlatform: storePlatform,
          reference: MosaicTransactionReference.tryFor(
            storePlatform,
            reference['value']! as String,
          )!,
          observedAt: DateTime.parse(expected['observedAt']! as String),
          context: MosaicTransactionObservationContext(
            platform: context['platform']! as String,
            sdkVersion: context['sdkVersion']! as String,
            applicationVersion: context['applicationVersion'] as String?,
            operatingSystemVersion:
                context['operatingSystemVersion'] as String?,
          ),
          providerOrderReference: order?['value'] as String?,
          correlation: correlation == null
              ? const MosaicTransactionObservationCorrelation()
              : MosaicTransactionObservationCorrelation.fromJson(
                  correlation.cast<String, Object?>(),
                ),
          claimedMosaicProductId: expected['claimedMosaicProductId'] as String?,
        );

        final document = observation.toJson();
        expect(document['billingIngestionContractVersion'], '1');
        expect(document['recordType'], 'clientTransactionObservation');
        final payload = (document['payload']! as Map).cast<String, Object?>();

        // The generated identifiers satisfy the contract's identifier shape.
        final identifier = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
        for (final generated in <String>[
          payload['observationId']! as String,
          payload['submissionId']! as String,
        ]) {
          expect(identifier.hasMatch(generated), isTrue, reason: generated);
          expect(generated.length, lessThanOrEqualTo(128));
        }
        // The submission identifier is deterministic, never random.
        expect(payload['submissionId'], isNot(payload['observationId']));

        payload['observationId'] = expected['observationId'];
        payload['submissionId'] = expected['submissionId'];
        (payload['context']! as Map)['sdkFamily'] = context['sdkFamily'];
        expect(payload, expected, reason: name);
      }
    });

    test('the record carries no field outside the contract', () async {
      final transport = _RecordingTransport();
      final runtime = _runtime(
        storage: MosaicMemoryTransactionObservationStorage(),
        transport: transport,
        storePlatform: MosaicStorePlatform.android,
      );
      final digest = ((_vectors()['googlePlayTokenDigest']! as Map)['vectors']!
              as List<Object?>)
          .cast<Map<String, Object?>>()
          .first['digest']! as String;
      await runtime.observe(
        providerId: _providerId,
        transactionReference: digest,
        providerOrderReference: 'fixture-GPA.0000-0000-0000-00001',
        mosaicProductId: 'fixture-mosaic-product-pro-monthly',
        correlation: const MosaicTransactionObservationCorrelation(
          providerUpdateId: 'fixture-provider-update-0002',
        ),
      );
      await runtime.flush();
      final document = transport.submitted.single.toJson();
      expect(document.keys.toSet(), <String>{
        'billingIngestionContractVersion',
        'recordType',
        'payload',
      });
      final payload = (document['payload']! as Map).cast<String, Object?>();
      expect(payload.keys.toSet(), <String>{
        'observationId',
        'submissionId',
        'providerId',
        'storePlatform',
        'transactionReference',
        'providerOrderReference',
        'observedAt',
        'sourceAuthority',
        'context',
        'correlation',
        'claimedMosaicProductId',
      });
      // A client observation can only trigger validation, never author a fact,
      // and never asserts a Store Environment.
      expect(payload['sourceAuthority'], 'client_observation');
      expect(payload.containsKey('storeEnvironment'), isFalse);
      expect(payload.containsKey('storeEnvironmentClassification'), isFalse);
      expect(payload.containsKey('subjectReference'), isFalse);
      expect(payload.containsKey('monetaryAmount'), isFalse);
      expect(
        (payload['transactionReference']! as Map)['referenceKind'],
        'google_play_token_digest',
      );
      expect((payload['transactionReference']! as Map)['value'], digest);
      expect(
        RegExp(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
            .hasMatch(payload['observedAt']! as String),
        isTrue,
      );
      expect((payload['context']! as Map)['sdkFamily'], 'flutter');
    });

    test('an Apple record can never carry a Google order reference', () async {
      final transport = _RecordingTransport();
      final runtime = _runtime(
        storage: MosaicMemoryTransactionObservationStorage(),
        transport: transport,
      );
      await runtime.observe(
        providerId: _providerId,
        transactionReference: '2000000900000001',
        providerOrderReference: 'fixture-GPA.0000-0000-0000-00001',
      );
      await runtime.flush();
      final payload = (transport.submitted.single.toJson()['payload']! as Map)
          .cast<String, Object?>();
      expect(payload.containsKey('providerOrderReference'), isFalse);
    });

    test('an observation without a Commerce Provider identity is dropped',
        () async {
      final transport = _RecordingTransport();
      final runtime = _runtime(
        storage: MosaicMemoryTransactionObservationStorage(),
        transport: transport,
      );
      for (final providerId in <String?>[null, '', '  ', '-leading-dash']) {
        expect(
          await runtime.observe(
            providerId: providerId,
            transactionReference: '2000000900000001',
          ),
          isFalse,
          reason: providerId ?? 'null',
        );
      }
      expect(transport.submitted, isEmpty);
      final diagnostics = await runtime.diagnostics();
      expect(diagnostics.incomplete, 4);
      expect(
          diagnostics.lastSafeCode, mosaicTransactionObservationIncompleteCode);
    });
  });
}

MosaicTransactionObservationRuntime _runtime({
  required MosaicTransactionObservationStorage storage,
  required MosaicTransactionObservationTransport transport,
  MosaicStorePlatform storePlatform = MosaicStorePlatform.ios,
  MosaicTransactionObservationSettings settings =
      const MosaicTransactionObservationSettings(),
}) =>
    MosaicTransactionObservationRuntime(
      namespace: _namespace,
      transport: transport,
      storePlatform: storePlatform,
      context: MosaicTransactionObservationContext(
        platform: storePlatform.wireValue,
        applicationVersion: '1.4.2',
        operatingSystemVersion: '18.5',
      ),
      settings: settings,
      storage: storage,
      random: () => 0,
    );

final class _RecordingTransport
    implements MosaicTransactionObservationTransport {
  final List<MosaicTransactionObservation> submitted =
      <MosaicTransactionObservation>[];

  @override
  Future<MosaicTransactionObservationSubmission> submit(
    MosaicTransactionObservation observation,
  ) async {
    submitted.add(observation);
    return MosaicTransactionObservationAcceptedForValidation(
      submissionId: observation.submissionId,
    );
  }
}

/// Replays scripted results, rewriting the placeholder submission identifier so
/// each answer acknowledges the record that was actually sent.
final class _ScriptedTransport
    implements MosaicTransactionObservationTransport {
  _ScriptedTransport(this._results);

  final List<MosaicTransactionObservationSubmission> _results;
  final List<String> submissionIds = <String>[];
  int _index = 0;

  @override
  Future<MosaicTransactionObservationSubmission> submit(
    MosaicTransactionObservation observation,
  ) async {
    submissionIds.add(observation.submissionId);
    final result = _results[_index.clamp(0, _results.length - 1)];
    _index++;
    return switch (result) {
      MosaicTransactionObservationAcceptedForValidation() =>
        MosaicTransactionObservationAcceptedForValidation(
          submissionId: observation.submissionId,
        ),
      MosaicTransactionObservationDuplicate() =>
        MosaicTransactionObservationDuplicate(
          submissionId: observation.submissionId,
        ),
      MosaicTransactionObservationPermanentlyRejected(:final safeCode) =>
        MosaicTransactionObservationPermanentlyRejected(
          submissionId: observation.submissionId,
          safeCode: safeCode,
        ),
      MosaicTransactionObservationRetryableFailure() => result,
    };
  }
}

/// Delivery that never completes: the queue must survive it.
final class _StalledTransport implements MosaicTransactionObservationTransport {
  @override
  Future<MosaicTransactionObservationSubmission> submit(
    MosaicTransactionObservation observation,
  ) =>
      Completer<MosaicTransactionObservationSubmission>().future;
}

final class _AlwaysRetryableTransport
    implements MosaicTransactionObservationTransport {
  int calls = 0;

  @override
  Future<MosaicTransactionObservationSubmission> submit(
    MosaicTransactionObservation observation,
  ) async {
    calls++;
    return const MosaicTransactionObservationRetryableFailure(
      safeCode: 'service_temporarily_unavailable',
      retryAfter: Duration.zero,
    );
  }
}

/// Phase 9B: the Customer Access Token binds a validated purchase to an
/// identified Billing Customer. Without it a purchase can only anchor to a
/// purchase-anchored customer, so the header is the association evidence rung
/// — and it must be read at send time, never stored with the queue.
void _customerTokenBindingTests() {
  MosaicTransactionObservation observation() => MosaicTransactionObservation(
        providerId: 'fixture-provider-apple',
        storePlatform: MosaicStorePlatform.ios,
        reference: MosaicTransactionReference.tryFor(
          MosaicStorePlatform.ios,
          '2000000900000001',
        )!,
        observedAt: DateTime.utc(2026, 7, 28, 12),
        context: const MosaicTransactionObservationContext(
          platform: 'ios',
          sdkVersion: '0.3.0',
        ),
      );

  Future<(HttpServer, List<HttpHeaders>)> acceptingServer() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final seen = <HttpHeaders>[];
    unawaited(() async {
      await for (final request in server) {
        seen.add(request.headers);
        await request.drain<void>();
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..write(jsonEncode(<String, Object?>{
            'billingIngestionContractVersion':
                mosaicBillingIngestionContractVersion,
            'recordType': 'observationSubmissionResult',
            'payload': <String, Object?>{
              'submissionId': observation().submissionId,
              'status': 'accepted_for_validation',
            },
          }));
        await request.response.close();
      }
    }());
    return (server, seen);
  }

  test('a held token binds the submission at send time', () async {
    final (server, seen) = await acceptingServer();
    addTearDown(() => server.close(force: true));
    final transport = MosaicIoTransactionObservationTransport(
      baseUrl: Uri.parse('http://127.0.0.1:${server.port}'),
      publicSdkKey: 'public_sdk_key_test',
      customerToken: () => 'mcat_customer_token',
    );

    final result = await transport.submit(observation());

    expect(result, isA<MosaicTransactionObservationAcceptedForValidation>());
    expect(seen.single.value('Mosaic-Customer-Token'), 'mcat_customer_token');
    // The public SDK key still identifies the application. Neither header
    // substitutes for the other.
    expect(seen.single.value('authorization'), 'Bearer public_sdk_key_test');
  });

  test('a signed-out submission omits the header rather than waiting',
      () async {
    final (server, seen) = await acceptingServer();
    addTearDown(() => server.close(force: true));
    final transport = MosaicIoTransactionObservationTransport(
      baseUrl: Uri.parse('http://127.0.0.1:${server.port}'),
      publicSdkKey: 'public_sdk_key_test',
      customerToken: () => null,
    );

    await transport.submit(observation());

    // Anonymous submission is valid. Blocking or minting here would turn a
    // fire-and-forget path into a dependency on the host's backend.
    expect(seen.single.value('Mosaic-Customer-Token'), isNull);
  });

  test('a token minted after the purchase still binds the retry', () async {
    final (server, seen) = await acceptingServer();
    addTearDown(() => server.close(force: true));
    String? held;
    final transport = MosaicIoTransactionObservationTransport(
      baseUrl: Uri.parse('http://127.0.0.1:${server.port}'),
      publicSdkKey: 'public_sdk_key_test',
      customerToken: () => held,
    );

    // Enqueued and sent while signed out, then sent again after sign-in. The
    // resolver is read at send time, so the second attempt carries the binding.
    await transport.submit(observation());
    held = 'mcat_after_sign_in';
    await transport.submit(observation());

    expect(seen.first.value('Mosaic-Customer-Token'), isNull);
    expect(seen.last.value('Mosaic-Customer-Token'), 'mcat_after_sign_in');
  });

  test('a resolver that throws never becomes a failed submission', () async {
    final (server, seen) = await acceptingServer();
    addTearDown(() => server.close(force: true));
    final transport = MosaicIoTransactionObservationTransport(
      baseUrl: Uri.parse('http://127.0.0.1:${server.port}'),
      publicSdkKey: 'public_sdk_key_test',
      customerToken: () => throw StateError('token unavailable'),
    );

    final result = await transport.submit(observation());

    expect(result, isA<MosaicTransactionObservationAcceptedForValidation>());
    expect(seen.single.value('Mosaic-Customer-Token'), isNull);
  });

  test('the token never reaches the persisted queue or diagnostics', () async {
    final storage = MosaicMemoryTransactionObservationStorage();
    final runtime = MosaicTransactionObservationRuntime(
      namespace: _namespace,
      transport: _NeverDeliversTransport(),
      storePlatform: MosaicStorePlatform.ios,
      context: const MosaicTransactionObservationContext(
        platform: 'ios',
        sdkVersion: '0.3.0',
      ),
      storage: storage,
    );

    await runtime.observe(
      providerId: 'fixture-provider-apple',
      transactionReference: '2000000900000001',
    );

    // The credential is a transport-time header and nothing else. A queue file
    // that carried it would persist a bearer token across app restarts.
    expect(storage.source, isNotNull);
    expect(storage.source, isNot(contains('mcat_')));
    expect(storage.source, isNot(contains('customerToken')));
    final diagnostics = await runtime.diagnostics();
    expect(diagnostics.toString(), isNot(contains('mcat_')));
    await runtime.disposeRuntime();
  });
}

final class _NeverDeliversTransport
    implements MosaicTransactionObservationTransport {
  @override
  Future<MosaicTransactionObservationSubmission> submit(
    MosaicTransactionObservation observation,
  ) =>
      Completer<MosaicTransactionObservationSubmission>().future;
}
