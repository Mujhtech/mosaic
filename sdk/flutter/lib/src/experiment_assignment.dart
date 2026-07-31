import 'dart:convert';

import 'placement_identity.dart';
import 'sha256.dart';

const mosaicExperimentAssignmentVersion = '1';
const mosaicExperimentBucketingAlgorithm =
    'experiment_sha256_length_prefixed_v1';
const mosaicExperimentGroupBucketingAlgorithm =
    'experiment_group_sha256_length_prefixed_v1';
const mosaicExperimentSchedulePolicy = 'trusted_server_time_v1';

enum MosaicExperimentLifecycle {
  scheduled,
  running,
  paused,
  stopped,
  completed
}

enum MosaicExperimentVariantRole { control, treatment }

enum MosaicExperimentAssignmentPolicy {
  installation,
  identifiedUser,
  identifiedUserOrInstallation,
}

final class MosaicExperimentVariant {
  MosaicExperimentVariant({
    required this.id,
    required this.name,
    required this.role,
    required this.paywallId,
    required this.paywallVersionId,
    required this.rangeStart,
    required this.rangeEnd,
    required Iterable<String> requiredProductIds,
    required Iterable<String> requiredProviderCapabilities,
  })  : requiredProductIds = Set.unmodifiable(requiredProductIds),
        requiredProviderCapabilities =
            Set.unmodifiable(requiredProviderCapabilities);
  final String id;
  final String name;
  final MosaicExperimentVariantRole role;
  final String paywallId;
  final String paywallVersionId;
  final int rangeStart;
  final int rangeEnd;
  final Set<String> requiredProductIds;
  final Set<String> requiredProviderCapabilities;
}

final class MosaicExperimentGroupMember {
  const MosaicExperimentGroupMember(this.experimentId, this.start, this.end);
  final String experimentId;
  final int start;
  final int end;
}

final class MosaicExperimentGroup {
  MosaicExperimentGroup({
    required this.id,
    required this.versionId,
    required Iterable<MosaicExperimentGroupMember> members,
    this.normalPlacementRange,
  }) : members = List.unmodifiable(members);
  final String id;
  final String versionId;
  final List<MosaicExperimentGroupMember> members;
  final ({int start, int end})? normalPlacementRange;
}

final class MosaicExperimentQaOverride {
  const MosaicExperimentQaOverride({
    required this.id,
    required this.variantId,
    required this.assignmentKeyType,
    required this.selectorDigest,
    required this.safeLabel,
    required this.startsAt,
    required this.expiresAt,
  });
  final String id;
  final String variantId;
  final String assignmentKeyType;
  final String selectorDigest;
  final String safeLabel;
  final DateTime startsAt;
  final DateTime expiresAt;
}

final class MosaicExperimentAssignment {
  MosaicExperimentAssignment({
    required this.projectId,
    required this.environmentId,
    required this.experimentId,
    required this.experimentVersionId,
    required this.placementId,
    required this.controlPaywallVersionId,
    required this.allocationVersion,
    required Iterable<MosaicExperimentVariant> variants,
    required this.assignmentPolicy,
    required this.lifecycle,
    required this.startsAt,
    required this.endsAt,
    required this.group,
    required Iterable<MosaicExperimentQaOverride> qaOverrides,
  })  : variants = List.unmodifiable(variants),
        qaOverrides = List.unmodifiable(qaOverrides);
  final String projectId;
  final String environmentId;
  final String experimentId;
  final String experimentVersionId;
  final String placementId;
  final String controlPaywallVersionId;
  final String allocationVersion;
  final List<MosaicExperimentVariant> variants;
  final MosaicExperimentAssignmentPolicy assignmentPolicy;
  final MosaicExperimentLifecycle lifecycle;
  final DateTime startsAt;
  final DateTime? endsAt;
  final MosaicExperimentGroup? group;
  final List<MosaicExperimentQaOverride> qaOverrides;
}

sealed class MosaicExperimentResult {
  const MosaicExperimentResult();
}

final class MosaicExperimentAssigned extends MosaicExperimentResult {
  const MosaicExperimentAssigned({
    required this.assignment,
    required this.variant,
    required this.assignmentKeyType,
    required this.bucket,
    required this.groupBucket,
    required this.qaOverride,
  });
  final MosaicExperimentAssignment assignment;
  final MosaicExperimentVariant variant;
  final String assignmentKeyType;
  final int bucket;
  final int? groupBucket;
  final bool qaOverride;
}

final class MosaicExperimentNormalPlacement extends MosaicExperimentResult {
  const MosaicExperimentNormalPlacement(this.reason);
  final String reason;
}

final class MosaicExperimentAssignmentEngine {
  const MosaicExperimentAssignmentEngine();

  MosaicExperimentResult evaluate({
    required MosaicExperimentAssignment assignment,
    required MosaicIdentityState identity,
    required DateTime? trustedNow,
    Set<String> qaTokens = const {},
  }) {
    final key = switch (assignment.assignmentPolicy) {
      MosaicExperimentAssignmentPolicy.installation => (
          'installation',
          identity.installationId
        ),
      MosaicExperimentAssignmentPolicy.identifiedUser =>
        identity.userId == null ? null : ('identified_user', identity.userId!),
      MosaicExperimentAssignmentPolicy.identifiedUserOrInstallation =>
        identity.userId == null
            ? ('installation', identity.installationId)
            : ('identified_user', identity.userId!),
    };
    if (key == null)
      return const MosaicExperimentNormalPlacement('missing_identity');
    final now = trustedNow?.toUtc();
    if (now != null) {
      for (final override in assignment.qaOverrides) {
        if (override.assignmentKeyType == key.$1 &&
            !now.isBefore(override.startsAt) &&
            now.isBefore(override.expiresAt) &&
            qaTokens.any((token) =>
                'sha256:${mosaicSha256String(token)}' ==
                override.selectorDigest)) {
          return MosaicExperimentAssigned(
            assignment: assignment,
            variant: assignment.variants
                .singleWhere((v) => v.id == override.variantId),
            assignmentKeyType: key.$1,
            bucket: bucket(assignment, key.$1, key.$2),
            groupBucket: null,
            qaOverride: true,
          );
        }
      }
    }
    if (now == null)
      return const MosaicExperimentNormalPlacement('time_unreliable');
    if (assignment.lifecycle != MosaicExperimentLifecycle.running &&
        assignment.lifecycle != MosaicExperimentLifecycle.scheduled) {
      return const MosaicExperimentNormalPlacement('inactive');
    }
    if (now.isBefore(assignment.startsAt)) {
      return const MosaicExperimentNormalPlacement('before_start');
    }
    if (assignment.endsAt case final end? when !now.isBefore(end)) {
      return const MosaicExperimentNormalPlacement('expired');
    }
    final group = assignment.group;
    final groupBucket = group == null
        ? null
        : groupBucketFor(assignment, group, key.$1, key.$2);
    if (group != null &&
        !group.members.any((member) =>
            member.experimentId == assignment.experimentId &&
            groupBucket! >= member.start &&
            groupBucket < member.end)) {
      return const MosaicExperimentNormalPlacement('group_excluded');
    }
    final value = bucket(assignment, key.$1, key.$2);
    return MosaicExperimentAssigned(
      assignment: assignment,
      variant: assignment.variants.singleWhere(
        (variant) => value >= variant.rangeStart && value < variant.rangeEnd,
      ),
      assignmentKeyType: key.$1,
      bucket: value,
      groupBucket: groupBucket,
      qaOverride: false,
    );
  }

  int bucket(MosaicExperimentAssignment value, String keyType, String key) =>
      _bucket('mosaic-experiment-assignment', [
        value.projectId,
        value.environmentId,
        value.experimentId,
        value.experimentVersionId,
        keyType,
        key,
      ]);
  int groupBucketFor(MosaicExperimentAssignment value,
          MosaicExperimentGroup group, String keyType, String key) =>
      _bucket('mosaic-experiment-group', [
        value.projectId,
        value.environmentId,
        group.id,
        group.versionId,
        keyType,
        key,
      ]);

  static List<int> canonicalBytes(String domain, List<String> values) =>
      utf8.encode(
          '$domain\n1\n${values.map((v) => '${utf8.encode(v).length}:$v\n').join()}');

  int _bucket(String domain, List<String> values) {
    final hex = mosaicSha256Hex(canonicalBytes(domain, values));
    var result = 0;
    for (var index = 0; index < 16; index += 2) {
      result = (result * 256 +
              int.parse(hex.substring(index, index + 2), radix: 16)) %
          10000;
    }
    return result;
  }
}

final class MosaicExperimentAssignmentDecoder {
  const MosaicExperimentAssignmentDecoder();
  static final _id = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
  static final _digest = RegExp(r'^sha256:[a-f0-9]{64}$');

  MosaicExperimentAssignment decode(Object? source,
      {required bool production}) {
    final wrapper = _object(source, 'experimentAssignment');
    _keys(wrapper, {'experimentAssignmentVersion', 'assignment'});
    if (wrapper['experimentAssignmentVersion'] != '1')
      _fail('Unsupported Experiment contract.');
    final value = _object(wrapper['assignment'], 'assignment');
    _keys(value, {
      'projectId',
      'environmentId',
      'experimentId',
      'experimentVersionId',
      'placementId',
      'controlPaywallVersionId',
      'allocationVersion',
      'variants',
      'assignmentKeyPolicy',
      'bucketingAlgorithm',
      'lifecycle',
      'schedule',
      'qaOverrides',
      'fallback',
      'compatibility'
    }, optional: {
      'mutualExclusionGroup'
    });
    if (value['bucketingAlgorithm'] != mosaicExperimentBucketingAlgorithm ||
        value['fallback'] != 'normal_placement')
      _fail('Unsupported Experiment semantics.');
    final variants = _list(value['variants']).map(_variant).toList();
    if (variants.length < 2 ||
        variants.length > 4 ||
        variants
                .where((v) => v.role == MosaicExperimentVariantRole.control)
                .length !=
            1 ||
        variants.map((v) => v.id).toSet().length != variants.length)
      _fail('Invalid Variants.');
    _ranges(variants.map((v) => (v.rangeStart, v.rangeEnd)).toList());
    final control = _identifier(value['controlPaywallVersionId']);
    if (variants
            .singleWhere((v) => v.role == MosaicExperimentVariantRole.control)
            .paywallVersionId !=
        control) _fail('Invalid Control anchor.');
    final policy = switch (value['assignmentKeyPolicy']) {
      'installation' => MosaicExperimentAssignmentPolicy.installation,
      'identified_user' => MosaicExperimentAssignmentPolicy.identifiedUser,
      'identified_user_or_installation' =>
        MosaicExperimentAssignmentPolicy.identifiedUserOrInstallation,
      _ => throw const FormatException('Invalid assignment policy.'),
    };
    final schedule = _object(value['schedule'], 'schedule');
    _keys(schedule, {'startsAt', 'timePolicy', 'unreliableTimeBehavior'},
        optional: {'endsAt'});
    if (schedule['timePolicy'] != mosaicExperimentSchedulePolicy ||
        schedule['unreliableTimeBehavior'] != 'normal_placement')
      _fail('Invalid schedule policy.');
    final starts = _time(schedule['startsAt']);
    final ends = schedule['endsAt'] == null ? null : _time(schedule['endsAt']);
    if (ends != null && !ends.isAfter(starts))
      _fail('Invalid schedule bounds.');
    final group = value['mutualExclusionGroup'] == null
        ? null
        : _group(value['mutualExclusionGroup']);
    final overrides = _list(value['qaOverrides']).map(_override).toList();
    if (production && overrides.isNotEmpty)
      _fail('QA overrides are forbidden in production.');
    if (overrides.any((o) => !variants.any((v) => v.id == o.variantId)))
      _fail('QA Variant is missing.');
    _compatibility(
        value['compatibility'],
        value['assignmentKeyPolicy'] as String,
        group != null,
        overrides.isNotEmpty);
    final lifecycle = switch (value['lifecycle']) {
      'scheduled' => MosaicExperimentLifecycle.scheduled,
      'running' => MosaicExperimentLifecycle.running,
      'paused' => MosaicExperimentLifecycle.paused,
      'stopped' => MosaicExperimentLifecycle.stopped,
      'completed' => MosaicExperimentLifecycle.completed,
      _ => throw const FormatException('Invalid Experiment lifecycle.'),
    };
    return MosaicExperimentAssignment(
      projectId: _identifier(value['projectId']),
      environmentId: _identifier(value['environmentId']),
      experimentId: _identifier(value['experimentId']),
      experimentVersionId: _identifier(value['experimentVersionId']),
      placementId: _identifier(value['placementId']),
      controlPaywallVersionId: control,
      allocationVersion: _identifier(value['allocationVersion']),
      variants: variants,
      assignmentPolicy: policy,
      lifecycle: lifecycle,
      startsAt: starts,
      endsAt: ends,
      group: group,
      qaOverrides: overrides,
    );
  }

  MosaicExperimentAssignment decodeEmbedded(Object? assignment,
          {required bool production}) =>
      decode(<String, Object?>{
        'experimentAssignmentVersion': mosaicExperimentAssignmentVersion,
        'assignment': assignment,
      }, production: production);

  MosaicExperimentVariant _variant(Object? source) {
    final v = _object(source, 'variant');
    _keys(v, {
      'id',
      'name',
      'role',
      'paywallId',
      'paywallVersionId',
      'rangeStart',
      'rangeEnd',
      'compatibility'
    });
    final c = _object(v['compatibility'], 'compatibility');
    _keys(c, {'requiredProductIds', 'requiredProviderCapabilities'});
    final products = _strings(c['requiredProductIds']);
    final capabilities = _strings(c['requiredProviderCapabilities']);
    const allowed = {
      'product_load',
      'purchase',
      'restore',
      'entitlement_lookup',
      'native_recovery'
    };
    if (!capabilities.every(allowed.contains))
      _fail('Unknown provider capability.');
    return MosaicExperimentVariant(
        id: _identifier(v['id']),
        name: _safe(v['name']),
        role: v['role'] == 'control'
            ? MosaicExperimentVariantRole.control
            : v['role'] == 'treatment'
                ? MosaicExperimentVariantRole.treatment
                : throw const FormatException('Invalid Variant role.'),
        paywallId: _identifier(v['paywallId']),
        paywallVersionId: _identifier(v['paywallVersionId']),
        rangeStart: _integer(v['rangeStart'], 0, 9999),
        rangeEnd: _integer(v['rangeEnd'], 1, 10000),
        requiredProductIds: products.map(_identifier),
        requiredProviderCapabilities: capabilities);
  }

  MosaicExperimentGroup _group(Object? source) {
    final g = _object(source, 'group');
    _keys(g, {'id', 'versionId', 'members', 'bucketingAlgorithm'},
        optional: {'normalPlacementRange'});
    if (g['bucketingAlgorithm'] != mosaicExperimentGroupBucketingAlgorithm)
      _fail('Invalid group algorithm.');
    final members = _list(g['members']).map((item) {
      final m = _object(item, 'member');
      _keys(m, {'experimentId', 'rangeStart', 'rangeEnd'});
      return MosaicExperimentGroupMember(
          _identifier(m['experimentId']),
          _integer(m['rangeStart'], 0, 9999),
          _integer(m['rangeEnd'], 1, 10000));
    }).toList();
    ({int start, int end})? normal;
    if (g['normalPlacementRange'] != null) {
      final n = _object(g['normalPlacementRange'], 'normalRange');
      _keys(n, {'rangeStart', 'rangeEnd'});
      normal = (
        start: _integer(n['rangeStart'], 0, 9999),
        end: _integer(n['rangeEnd'], 1, 10000)
      );
    }
    _ranges([
      ...members.map((m) => (m.start, m.end)),
      if (normal != null) (normal.start, normal.end)
    ]);
    return MosaicExperimentGroup(
        id: _identifier(g['id']),
        versionId: _identifier(g['versionId']),
        members: members,
        normalPlacementRange: normal);
  }

  MosaicExperimentQaOverride _override(Object? source) {
    final q = _object(source, 'override');
    _keys(q, {
      'id',
      'variantId',
      'assignmentKeyType',
      'selectorDigest',
      'safeLabel',
      'startsAt',
      'expiresAt',
      'visibility'
    });
    final starts = _time(q['startsAt']);
    final expires = _time(q['expiresAt']);
    if (q['visibility'] != 'diagnostic' ||
        !_digest.hasMatch(q['selectorDigest'] as String? ?? '') ||
        !expires.isAfter(starts) ||
        expires.difference(starts) > const Duration(hours: 24))
      _fail('Invalid QA override.');
    final type = q['assignmentKeyType'];
    if (type != 'installation' && type != 'identified_user')
      _fail('Invalid QA identity.');
    return MosaicExperimentQaOverride(
        id: _identifier(q['id']),
        variantId: _identifier(q['variantId']),
        assignmentKeyType: type as String,
        selectorDigest: q['selectorDigest'] as String,
        safeLabel: _safe(q['safeLabel']),
        startsAt: starts,
        expiresAt: expires);
  }

  void _compatibility(Object? source, String policy, bool group, bool qa) {
    final c = _object(source, 'compatibility');
    _keys(c, {'requiredFeatures', 'bucketingAlgorithms', 'schedulePolicies'});
    final expectedFeatures = {
      'allocation.ranges',
      'assignment.$policy',
      'fallback.normal_placement',
      'schedule.trusted_server_time',
      if (group) 'group.mutual_exclusion',
      if (qa) 'override.qa'
    };
    final expectedAlgorithms = {
      mosaicExperimentBucketingAlgorithm,
      if (group) mosaicExperimentGroupBucketingAlgorithm
    };
    if (_strings(c['requiredFeatures'])
            .toSet()
            .difference(expectedFeatures)
            .isNotEmpty ||
        expectedFeatures
            .difference(_strings(c['requiredFeatures']).toSet())
            .isNotEmpty ||
        _strings(c['bucketingAlgorithms'])
            .toSet()
            .difference(expectedAlgorithms)
            .isNotEmpty ||
        expectedAlgorithms
            .difference(_strings(c['bucketingAlgorithms']).toSet())
            .isNotEmpty ||
        _strings(c['schedulePolicies']).toSet().single !=
            mosaicExperimentSchedulePolicy)
      _fail('Compatibility declaration is not exact.');
  }

  static Map<String, Object?> _object(Object? value, String name) {
    if (value is! Map) throw FormatException('$name must be an object.');
    return value.cast<String, Object?>();
  }

  static List<Object?> _list(Object? value) {
    if (value is! List) _fail('Expected array.');
    return value as List<Object?>;
  }

  static List<String> _strings(Object? value) {
    final values = _list(value);
    if (values.any((v) => v is! String) ||
        values.toSet().length != values.length)
      _fail('Expected unique strings.');
    return values.cast<String>();
  }

  static void _keys(Map<String, Object?> value, Set<String> required,
      {Set<String> optional = const {}}) {
    if (!value.keys.toSet().difference({...required, ...optional}).isEmpty ||
        !required.every(value.containsKey))
      _fail('Unexpected or missing field.');
  }

  static String _identifier(Object? value) {
    if (value is! String || !_id.hasMatch(value)) _fail('Invalid identifier.');
    return value;
  }

  static String _safe(Object? value) {
    if (value is! String ||
        value.isEmpty ||
        value.length > 160 ||
        value.runes.any((r) => r < 0x20 || r == 0x7f))
      _fail('Invalid safe string.');
    return value;
  }

  static int _integer(Object? value, int min, int max) {
    if (value is! int || value < min || value > max) _fail('Invalid integer.');
    return value;
  }

  static DateTime _time(Object? value) {
    if (value is! String || !value.endsWith('Z'))
      _fail('Invalid UTC timestamp.');
    return DateTime.parse(value).toUtc();
  }

  static void _ranges(List<(int, int)> ranges) {
    final sorted = [...ranges]..sort((a, b) => a.$1.compareTo(b.$1));
    if (sorted.isEmpty ||
        sorted.first.$1 != 0 ||
        sorted.last.$2 != 10000 ||
        sorted.any((r) => r.$1 >= r.$2)) _fail('Invalid allocation coverage.');
    for (var i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].$2 != sorted[i].$1)
        _fail('Allocation must be gap-free.');
    }
  }

  static Never _fail(String message) => throw FormatException(message);
}
