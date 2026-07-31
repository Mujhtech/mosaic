import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// Conformance against the canonical Authoritative Entitlement v1 fixtures.
///
/// The SDK entitlement sync surface carries exactly two record types. Fixtures
/// for the other surfaces are asserted to be *rejected here*, which documents
/// the boundary rather than pretending the SDK reads a trusted-server record.
void main() {
  const decoder = MosaicCustomerEntitlementDecoder();
  final root = repositoryDirectory(
    'protocol/fixtures/authoritative-entitlement/v1',
  );

  group('canonical authority-aware v2 fixtures', () {
    const authorityDecoder = MosaicCustomerAuthorityDecoder();
    final v2Root = repositoryDirectory(
      'protocol/fixtures/authoritative-entitlement/v2',
    );
    for (final name in const <String>[
      'ios-full-snapshot.json',
      'android-full-snapshot.json',
      'source-snapshot.json',
      'snapshot-unchanged.json',
      'android-snapshot-unchanged.json',
      'authority-unavailable.json',
      'authority-policy-unavailable.json',
    ]) {
      test('$name decodes at the authority boundary', () {
        final record = authorityDecoder.decode(
          File('${v2Root.path}/$name').readAsStringSync(),
        );
        if (record case final MosaicCustomerAuthoritySnapshotRecord snapshot) {
          expect(snapshot.snapshotRecord.contentDigestValid, isTrue);
          expect(snapshot.snapshotAuthorityDigestValid, isTrue);
        } else if (record
            case final MosaicCustomerAuthorityUnavailableRecord unavailable) {
          if (unavailable.reason ==
              MosaicCustomerAuthorityUnavailableReason.policyUnavailable) {
            expect(unavailable.minimumSupport, isNull);
          } else {
            expect(unavailable.minimumSupport, isNotNull);
          }
        }
      });
    }

    for (final file in canonicalFixtureFiles(
      Directory('${v2Root.path}/invalid'),
    )) {
      if (file.uri.pathSegments.last == 'rejection-layers.json') continue;
      test('${file.uri.pathSegments.last} is rejected by the SDK reader', () {
        expect(
          () => authorityDecoder.decode(file.readAsStringSync()),
          throwsA(isA<MosaicCustomerEntitlementFormatException>()),
        );
      });
    }
  });

  group('canonical snapshot fixtures', () {
    for (final file
        in canonicalFixtureFiles(Directory('${root.path}/snapshots'))) {
      final name = file.uri.pathSegments.last;
      test('$name is read whole', () {
        final record = decoder.decode(file.readAsStringSync());
        switch (record) {
          case MosaicCustomerSnapshotRecord(
              :final snapshot,
              :final contentDigestValid
            ):
            // Every published snapshot digests to the value it carries. A
            // failure here means Dart's canonical serialization has drifted
            // from the four other implementations.
            expect(contentDigestValid, isTrue);
            expect(snapshot.snapshotVersion, greaterThanOrEqualTo(0));
            expect(snapshot.correlationId, isNotEmpty);
          case MosaicCustomerUnchangedRecord(:final unchanged):
            expect(unchanged.snapshotVersion, greaterThan(0));
        }
      });
    }

    test('a permanent source reports no finite expiry', () {
      // Reporting the subscription's end date when a lifetime purchase also
      // contributes would tell a lifetime purchaser their access expires.
      final record = decoder.decode(
        File('${root.path}/snapshots/permanent-source-no-finite-expiry.json')
            .readAsStringSync(),
      ) as MosaicCustomerSnapshotRecord;
      final entry = record.snapshot.entries.first;
      expect(entry.state, MosaicCustomerEntitlementState.active);
      expect(entry.endKnown, isTrue);
      expect(entry.effectiveEnd, isNull);
      expect(entry.isPermanent, isTrue);
    });

    test('a test-derived source is flagged on the source it came from', () {
      final record = decoder.decode(
        File('${root.path}/snapshots/test-source-sandbox-grant.json')
            .readAsStringSync(),
      ) as MosaicCustomerSnapshotRecord;
      expect(
        record.snapshot.sources.any((source) => source.isTestSource),
        isTrue,
      );
    });

    test('an unknown entry keeps a non-definite uncertainty', () {
      final record = decoder.decode(
        File('${root.path}/snapshots/unknown-state-identity-unresolved.json')
            .readAsStringSync(),
      ) as MosaicCustomerSnapshotRecord;
      final entry = record.snapshot.entries.first;
      expect(entry.state, MosaicCustomerEntitlementState.unknown);
      expect(entry.uncertainty?.isDefinite, isFalse);
      expect(entry.uncertainty?.since, isNotNull);
    });

    test('bounded offline caching states its grace window explicitly', () {
      final record = decoder.decode(
        File('${root.path}/snapshots/bounded-offline-cache.json')
            .readAsStringSync(),
      ) as MosaicCustomerSnapshotRecord;
      expect(record.snapshot.staleGraceSeconds, greaterThan(0));
    });
  });

  group('invalid fixtures', () {
    final invalid = Directory('${root.path}/invalid');
    final layers = (jsonDecode(
      File('${invalid.path}/rejection-layers.json').readAsStringSync(),
    ) as Map<String, Object?>)['layers']! as Map<String, Object?>;

    // Classified producer-side: the semantic validator rejects it, and a
    // reader that inferred intent from a value's shape would diverge from the
    // other SDKs. Asserted separately below.
    const producerSideOnly = <String>{
      'snapshot-carries-signed-payload-value.json',
    };

    for (final file in canonicalFixtureFiles(invalid)) {
      final name = file.uri.pathSegments.last;
      if (producerSideOnly.contains(name)) continue;
      test('$name never yields access', () {
        final source = file.readAsStringSync();
        String? reasonCode;
        var digestValid = true;
        try {
          final record = decoder.decode(source);
          if (record is MosaicCustomerSnapshotRecord) {
            digestValid = record.contentDigestValid;
          }
        } on MosaicCustomerEntitlementFormatException catch (error) {
          reasonCode = error.reasonCode;
        }
        // Rejection is either a thrown reason or a failed binding digest.
        // Nothing in between: partial acceptance is forbidden, so there is no
        // path where some entries of an invalid document survive.
        expect(
          reasonCode != null || !digestValid,
          isTrue,
          reason: '$name was accepted whole.',
        );
        expect(layers.containsKey(name), isTrue,
            reason: '$name is not classified in rejection-layers.json.');
      });
    }

    test('a version regressing against its own predecessor is semantic', () {
      // No JSON Schema can express this cross-field arithmetic, so the reader
      // owns it. rejection-layers.json classifies it as semantic.
      expect(layers['older-snapshot-version-rejected.json'], 'semantic');
      expect(
        () => decoder.decode(
          File('${invalid.path}/older-snapshot-version-rejected.json')
              .readAsStringSync(),
        ),
        throwsA(
          isA<MosaicCustomerEntitlementFormatException>().having(
            (error) => error.reasonCode,
            'reasonCode',
            'semantic_invariant_violated',
          ),
        ),
      );
    });

    test('a digest computed over another customer fails binding', () {
      expect(layers['different-customer-rejected.json'], 'semantic');
      final record = decoder.decode(
        File('${invalid.path}/different-customer-rejected.json')
            .readAsStringSync(),
      ) as MosaicCustomerSnapshotRecord;
      // The document is structurally readable; the digest is exactly what
      // catches the binding failure, which is what the digest exists for.
      expect(record.contentDigestValid, isFalse);
    });

    test('an unknown field rejects the whole record', () {
      expect(
        () => decoder.decode(
          File('${invalid.path}/snapshot-entry-unknown-field.json')
              .readAsStringSync(),
        ),
        throwsA(
          isA<MosaicCustomerEntitlementFormatException>().having(
            (error) => error.reasonCode,
            'reasonCode',
            'unknown_field',
          ),
        ),
      );
    });

    test('an unsupported contract version rejects before anything else', () {
      expect(
        () => decoder.decode(
          File('${invalid.path}/unknown-contract-version.json')
              .readAsStringSync(),
        ),
        throwsA(
          isA<MosaicCustomerEntitlementFormatException>().having(
            (error) => error.reasonCode,
            'reasonCode',
            'unsupported_contract_version',
          ),
        ),
      );
    });

    test('a signed-payload-shaped identifier is a producer-side rejection', () {
      // Cross-SDK alignment: iOS, Android, and Flutter all accept this record
      // as a reader. The shape of a correlation identifier is not something a
      // reader is entitled to infer intent from, and the semantic validator is
      // where the defect is caught.
      expect(layers['snapshot-carries-signed-payload-value.json'], 'semantic');
      final record = decoder.decode(
        File('${invalid.path}/snapshot-carries-signed-payload-value.json')
            .readAsStringSync(),
      ) as MosaicCustomerSnapshotRecord;
      expect(record.contentDigestValid, isTrue);
    });
  });

  group('other contract surfaces', () {
    for (final directory in const <String>[
      'checks',
      'subscriptions',
      'restores'
    ]) {
      for (final file
          in canonicalFixtureFiles(Directory('${root.path}/$directory'))) {
        final name = file.uri.pathSegments.last;
        test('$directory/$name is not read by the SDK sync surface', () {
          expect(
            () => decoder.decode(file.readAsStringSync()),
            throwsA(
              isA<MosaicCustomerEntitlementFormatException>().having(
                (error) => error.reasonCode,
                'reasonCode',
                'unsupported_record_type',
              ),
            ),
          );
        });
      }
    }
  });
}
