import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// The cross-platform divergence guard.
///
/// Go, Dart, Swift, and Kotlin must agree on these three tables exactly. They
/// are read straight from the shared reference vectors rather than restated
/// here, so a Dart implementation that drifts from the contract fails even when
/// it is internally self-consistent.
void main() {
  group('entitlement snapshot digest vectors', () {
    final vectors = _vectors('entitlement-snapshot-digest-vectors.json');

    for (final vector in vectors) {
      final id = vector['id']! as String;
      test('$id digests canonically', () {
        final payload = (vector['payload']! as Map).cast<String, Object?>();
        final excluded = vector['excludedMember'] as String? ?? 'contentDigest';
        expect(
          mosaicCustomerContentDigest(payload, excludedMember: excluded),
          vector['digest'],
          reason: vector['notes'] as String?,
        );
      });
    }

    test('covers every published vector', () {
      expect(vectors, hasLength(9));
    });
  });

  group('entitlement cache decision vectors', () {
    final document = _document('entitlement-cache-decision-vectors.json');
    final vectors = (document['vectors']! as List).cast<Map<String, Object?>>();

    for (final vector in vectors) {
      final id = vector['id']! as String;
      test('$id decides as the contract requires', () {
        final incoming = (vector['incoming']! as Map).cast<String, Object?>();
        final rawCached = vector['cached'];
        final decision = mosaicEvaluateCustomerCacheDecision(
          contractVersion: incoming['contractVersion']! as String,
          incomingBinding: _binding(incoming),
          incomingSnapshotVersion: incoming['snapshotVersion']! as int,
          incomingAsOf: DateTime.parse(incoming['asOf']! as String),
          contentDigestValid: incoming['contentDigestValid']! as bool,
          cached: rawCached == null
              ? null
              : _cached((rawCached as Map).cast<String, Object?>()),
        );
        expect(
          decision.accepted,
          vector['decision'] == 'accept',
          reason: vector['notes'] as String?,
        );
        expect(decision.reasonCode, vector['reason']);
        expect(decision.cacheAction.name, _action(vector['cacheAction']));
      });
    }

    test('no rejection vector ever resolves to inactive', () {
      // The contract's top rule, asserted against the vector table itself so a
      // future vector that said otherwise would fail here rather than ship.
      for (final vector in vectors) {
        if (vector['decision'] == 'reject') {
          expect(vector['resultingAccessState'], isNot('inactive'));
        }
      }
    });

    test('covers every published vector', () {
      expect(vectors, hasLength(11));
    });
  });

  group('entitlement freshness vectors', () {
    final document = _document('entitlement-freshness-vectors.json');
    final vectors = (document['vectors']! as List).cast<Map<String, Object?>>();

    for (final vector in vectors) {
      final id = vector['id']! as String;
      test('$id lands in the published band', () {
        final snapshot = (vector['snapshot']! as Map).cast<String, Object?>();
        final state = mosaicEvaluateCustomerFreshness(
          issuedAt: DateTime.parse(snapshot['issuedAt']! as String),
          refreshAfter: DateTime.parse(snapshot['refreshAfter']! as String),
          validUntil: DateTime.parse(snapshot['validUntil']! as String),
          staleGraceSeconds: snapshot['staleGraceSeconds']! as int,
          deviceNow: DateTime.parse(vector['deviceNow']! as String),
          clockSkewToleranceSeconds:
              vector['clockSkewToleranceSeconds']! as int,
        );
        expect(
          state,
          _cacheState(vector['state']! as String),
          reason: vector['notes'] as String?,
        );
      });
    }

    test('the shipped policy is bounded grace with a 60-second tolerance', () {
      final policy = (document['policy']! as Map).cast<String, Object?>();
      expect(policy['name'], 'boundedGrace');
      expect(
        policy['clockSkewToleranceSeconds'],
        mosaicCustomerEntitlementClockSkewToleranceSeconds,
      );
      expect(
        policy['defaultStaleGraceSeconds'],
        mosaicCustomerEntitlementDefaultStaleGraceSeconds,
      );
      expect(
        policy['maxCacheHorizonSeconds'],
        mosaicCustomerEntitlementMaximumCacheHorizonSeconds,
      );
    });

    test('covers every published vector', () {
      expect(vectors, hasLength(12));
    });
  });
}

Map<String, Object?> _document(String name) => jsonDecode(
      repositoryFile('packages/test-fixtures/src/$name').readAsStringSync(),
    ) as Map<String, Object?>;

List<Map<String, Object?>> _vectors(String name) =>
    (_document(name)['vectors']! as List).cast<Map<String, Object?>>();

MosaicCustomerBinding _binding(Map<String, Object?> value) =>
    MosaicCustomerBinding(
      billingCustomerId: value['billingCustomerId']! as String,
      projectId: value['projectId']! as String,
      environmentId: value['environmentId']! as String,
    );

MosaicCustomerCachedSnapshotSummary _cached(Map<String, Object?> value) =>
    MosaicCustomerCachedSnapshotSummary(
      binding: _binding(value),
      snapshotVersion: value['snapshotVersion']! as int,
      asOf: DateTime.parse(value['asOf']! as String),
    );

String _action(Object? value) => switch (value) {
      'replace' => 'replace',
      'preserve' => 'preserve',
      'clear' => 'clear',
      _ => fail('Unknown cache action $value.'),
    };

MosaicEntitlementCacheState _cacheState(String value) => switch (value) {
      'fresh' => MosaicEntitlementCacheState.fresh,
      'refresh_recommended' => MosaicEntitlementCacheState.refreshRecommended,
      'stale_within_grace' => MosaicEntitlementCacheState.staleWithinGrace,
      'expired' => MosaicEntitlementCacheState.expired,
      _ => fail('Unknown freshness state $value.'),
    };
