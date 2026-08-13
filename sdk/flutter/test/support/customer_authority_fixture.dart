import 'dart:convert';
import 'dart:io';

import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'canonical_fixture.dart';

/// The Application the canonical iOS-scoped records are authored against.
const String fixtureAuthorityApplicationId = 'fixture-application-ios';

/// The Authoritative Entitlement corpus. ADR-0028 leaves exactly one version
/// of the contract, so there is one directory and no version selection.
final Directory customerAuthorityFixtureRoot = repositoryDirectory(
  'protocol/fixtures/authoritative-entitlement/v2',
);

/// Reads a canonical record verbatim.
String customerAuthorityFixture(String relativePath) =>
    File('${customerAuthorityFixtureRoot.path}/$relativePath')
        .readAsStringSync();

/// Lowers a record's stated client floor to what this build reports.
///
/// Only for tests that reach the runtime through `Mosaic.configure`, which
/// constructs it internally and exposes no SDK-version seam. Every test that
/// builds a runtime directly injects [fixtureSupportedSdkVersion] and reads the
/// corpus verbatim instead; prefer that.
///
/// `minimumSupport` contributes to neither digest — `contentDigest` covers the
/// snapshot and `snapshotAuthorityDigest` covers `{authority, snapshot}` — so
/// both stay exactly as published.
String customerRecordAcceptedByConfiguredSdk(String source) {
  final envelope = (jsonDecode(source) as Map).cast<String, Object?>();
  final payload = (envelope['payload']! as Map).cast<String, Object?>();
  final support = (payload['minimumSupport']! as Map).cast<String, Object?>();
  support['minimumSdkVersion'] = mosaicFlutterSdkVersion;
  payload['minimumSupport'] = support;
  envelope['payload'] = payload;
  return jsonEncode(envelope);
}

/// The SDK version a runtime must report to satisfy the canonical corpus.
///
/// The published records declare `minimumSupport.minimumSdkVersion` at
/// `2.0.0`. Tests inject this rather than rewriting the fixture, so the
/// support gate is exercised against the floor the contract actually
/// publishes; a test that lowered the floor in the document would never
/// exercise it at all.
const String fixtureSupportedSdkVersion = '2.0.0';

/// Rebuilds a canonical snapshot record with a mutated authority or inner
/// snapshot, recomputing the snapshot's own `contentDigest` and the
/// `snapshotAuthorityDigest` over `{authority, snapshot}`.
///
/// Recomputing both is what keeps a variant on the acceptance path rather than
/// the corruption path: a mutation that only refreshed `contentDigest` would
/// be rejected for a broken binding digest, and a test written that way would
/// pass for the wrong reason. The support floor is left exactly as published;
/// callers meet it by injecting [fixtureSupportedSdkVersion].
String customerSnapshotRecordVariant(
  String source, {
  int? authorityEpoch,
  void Function(
    Map<String, Object?> authority,
    Map<String, Object?> snapshot,
  )? mutate,
}) {
  final envelope = (jsonDecode(source) as Map).cast<String, Object?>();
  final payload = (envelope['payload']! as Map).cast<String, Object?>();
  final authority = (payload['authority']! as Map).cast<String, Object?>();
  final snapshot = (payload['snapshot']! as Map).cast<String, Object?>();
  if (authorityEpoch != null) authority['authorityEpoch'] = authorityEpoch;
  mutate?.call(authority, snapshot);
  snapshot['contentDigest'] = mosaicCustomerContentDigest(snapshot);
  payload
    ..['authority'] = authority
    ..['snapshot'] = snapshot
    ..['snapshotAuthorityDigest'] =
        mosaicCustomerSnapshotAuthorityDigest(authority, snapshot);
  envelope['payload'] = payload;
  return jsonEncode(envelope);
}
