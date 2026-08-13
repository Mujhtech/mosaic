import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';
import 'support/customer_authority_fixture.dart';

/// Conformance against the canonical Authoritative Entitlement fixtures.
///
/// ADR-0028 leaves the contract at one version, so a whole record is read by
/// [MosaicCustomerAuthorityDecoder] and the snapshot it wraps is reached
/// through `snapshotRecord`. The sync surface carries three record types;
/// fixtures for the other surfaces are asserted to be *rejected here*, which
/// documents the boundary rather than pretending the SDK reads a
/// trusted-server record.
void main() {
  const authorityDecoder = MosaicCustomerAuthorityDecoder();
  const recordDecoder = MosaicCustomerEntitlementDecoder();
  final root = customerAuthorityFixtureRoot;

  group('canonical records', () {
    // The per-scenario snapshots plus the top-level records, which are where
    // the confirmation and authority-unavailable record types live.
    final names = <String>[
      for (final file
          in canonicalFixtureFiles(Directory('${root.path}/snapshots')))
        'snapshots/${file.uri.pathSegments.last}',
      'ios-full-snapshot.json',
      'android-full-snapshot.json',
      'source-snapshot.json',
      'snapshot-unchanged.json',
      'android-snapshot-unchanged.json',
      'authority-unavailable.json',
      'authority-policy-unavailable.json',
    ];

    for (final name in names) {
      test('$name is read whole', () {
        final record = authorityDecoder.decode(customerAuthorityFixture(name));
        switch (record) {
          case MosaicCustomerAuthoritySnapshotRecord(
              :final snapshotRecord,
              :final snapshotAuthorityDigestValid
            ):
            // Every published record digests to both values it carries: the
            // snapshot's own content digest and the digest binding that
            // snapshot to its authority. A failure here means Dart's canonical
            // serialization has drifted from the other implementations.
            expect(snapshotRecord.contentDigestValid, isTrue);
            expect(snapshotAuthorityDigestValid, isTrue);
            expect(
              snapshotRecord.snapshot.snapshotVersion,
              greaterThanOrEqualTo(0),
            );
            expect(snapshotRecord.snapshot.correlationId, isNotEmpty);
          case MosaicCustomerAuthorityUnchangedRecord(
              :final unchanged,
              :final snapshotAuthorityDigest
            ):
            // A confirmation never carries version zero: there is nothing for
            // it to confirm.
            expect(unchanged.snapshotVersion, greaterThan(0));
            expect(snapshotAuthorityDigest, isNotEmpty);
          case MosaicCustomerAuthorityUnavailableRecord(
              :final reason,
              :final minimumSupport
            ):
            // A policy instruction is the one record forbidden to state a
            // client floor; every other unavailable reason must state one.
            expect(
              minimumSupport,
              reason ==
                      MosaicCustomerAuthorityUnavailableReason.policyUnavailable
                  ? isNull
                  : isNotNull,
            );
        }
      });
    }

    MosaicCustomerEntitlementSnapshot snapshot(String name) =>
        (authorityDecoder.decode(customerAuthorityFixture('snapshots/$name'))
                as MosaicCustomerAuthoritySnapshotRecord)
            .snapshotRecord
            .snapshot;

    test('a permanent source reports no finite expiry', () {
      // Reporting the subscription's end date when a lifetime purchase also
      // contributes would tell a lifetime purchaser their access expires.
      final entry =
          snapshot('permanent-source-no-finite-expiry.json').entries.first;
      expect(entry.state, MosaicCustomerEntitlementState.active);
      expect(entry.endKnown, isTrue);
      expect(entry.effectiveEnd, isNull);
      expect(entry.isPermanent, isTrue);
    });

    test('a test-derived source is flagged on the source it came from', () {
      expect(
        snapshot('test-source-sandbox-grant.json')
            .sources
            .any((source) => source.isTestSource),
        isTrue,
      );
    });

    test('an unknown entry keeps a non-definite uncertainty', () {
      final entry =
          snapshot('unknown-state-identity-unresolved.json').entries.first;
      expect(entry.state, MosaicCustomerEntitlementState.unknown);
      expect(entry.uncertainty?.isDefinite, isFalse);
      expect(entry.uncertainty?.since, isNotNull);
    });

    test('bounded offline caching states its grace window explicitly', () {
      expect(
        snapshot('bounded-offline-cache.json').staleGraceSeconds,
        greaterThan(0),
      );
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
          final record = authorityDecoder.decode(source);
          if (record is MosaicCustomerAuthoritySnapshotRecord) {
            // Both digests, exactly as the acceptance gate combines them: a
            // record whose snapshot is intact but whose authority binding is
            // not has still failed.
            digestValid = record.snapshotRecord.contentDigestValid &&
                record.snapshotAuthorityDigestValid;
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
        () => authorityDecoder.decode(
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
      final record = authorityDecoder.decode(
        File('${invalid.path}/different-customer-rejected.json')
            .readAsStringSync(),
      ) as MosaicCustomerAuthoritySnapshotRecord;
      // The document is structurally readable; the digest is exactly what
      // catches the binding failure, which is what the digest exists for.
      expect(record.snapshotRecord.contentDigestValid, isFalse);
    });

    test('an unknown field rejects the whole record', () {
      expect(
        () => authorityDecoder.decode(
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
        () => authorityDecoder.decode(
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
      final record = authorityDecoder.decode(
        File('${invalid.path}/snapshot-carries-signed-payload-value.json')
            .readAsStringSync(),
      ) as MosaicCustomerAuthoritySnapshotRecord;
      expect(record.snapshotRecord.contentDigestValid, isTrue);
      expect(record.snapshotAuthorityDigestValid, isTrue);
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
          final source = file.readAsStringSync();
          // These records are envelope-valid at the current contract version,
          // so what refuses them is the closed record-type set rather than a
          // version check. Both readers refuse: the whole-record reader the
          // runtime uses, and the snapshot reader it delegates to.
          expect(
            () => authorityDecoder.decode(source),
            throwsA(isA<MosaicCustomerEntitlementFormatException>()),
          );
          expect(
            () => recordDecoder.decode(source),
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
