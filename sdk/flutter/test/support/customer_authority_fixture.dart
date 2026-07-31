import 'dart:convert';

import 'package:mosaic_sdk/mosaic_sdk.dart';

const String fixtureAuthorityApplicationId = 'fixture-application-ios';

Map<String, Object?> _authority(
  Map<String, Object?> payload, {
  int epoch = 5,
}) =>
    <String, Object?>{
      'authorityEpoch': epoch,
      'authorityKind': 'mosaic',
      'scope': <String, Object?>{
        'projectId': payload['projectId'],
        'environmentId': payload['environmentId'],
        'applicationId': fixtureAuthorityApplicationId,
        'platform': 'ios',
      },
      'transitionState': 'stabilizing',
      'cutoverAt': '2026-07-28T12:30:00.000Z',
    };

const Map<String, Object?> _minimumSupport = <String, Object?>{
  'minimumContractVersion': '2',
  'minimumSdkVersion': '0.1.0',
  'supportedAppVersionWindow': <String, Object?>{
    'minimumInclusive': '4.0.0',
  },
  'requiredCapabilities': <String>[
    'authority_epoch',
    'urgent_authority_sync',
  ],
};

String wrapCustomerSnapshotV2(String v1Source, {int epoch = 5}) {
  final envelope = (jsonDecode(v1Source) as Map).cast<String, Object?>();
  final snapshot = (envelope['payload']! as Map).cast<String, Object?>();
  final authority = _authority(snapshot, epoch: epoch);
  return jsonEncode(<String, Object?>{
    'authoritativeEntitlementContractVersion': '2',
    'recordType': 'customerEntitlementSnapshot',
    'payload': <String, Object?>{
      'authority': authority,
      'snapshot': snapshot,
      'snapshotAuthorityDigest':
          mosaicCustomerSnapshotAuthorityDigest(authority, snapshot),
      'minimumSupport': _minimumSupport,
    },
  });
}

String wrapCustomerUnchangedV2(
  String v1UnchangedSource,
  String retainedV1SnapshotSource, {
  int epoch = 5,
}) {
  final unchangedEnvelope =
      (jsonDecode(v1UnchangedSource) as Map).cast<String, Object?>();
  final unchanged =
      (unchangedEnvelope['payload']! as Map).cast<String, Object?>();
  final snapshotEnvelope =
      (jsonDecode(retainedV1SnapshotSource) as Map).cast<String, Object?>();
  final snapshot =
      (snapshotEnvelope['payload']! as Map).cast<String, Object?>();
  final authority = _authority(unchanged, epoch: epoch);
  return jsonEncode(<String, Object?>{
    'authoritativeEntitlementContractVersion': '2',
    'recordType': 'snapshotUnchanged',
    'payload': <String, Object?>{
      'authority': authority,
      'unchanged': unchanged,
      'snapshotAuthorityDigest':
          mosaicCustomerSnapshotAuthorityDigest(authority, snapshot),
      'minimumSupport': _minimumSupport,
    },
  });
}
