import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'experiment_assignment.dart';
import 'sha256.dart';

const int mosaicMaximumPersistedAssignments = 256;
const Duration mosaicAssignmentRetention = Duration(days: 180);

String mosaicExperimentAssignmentNamespace(Uri baseUrl, String publicSdkKey) =>
    mosaicSha256String(
        '${baseUrl.toString()}\n$publicSdkKey\nexperiment-assignments-v1');

final class MosaicPersistedExperimentAssignment {
  const MosaicPersistedExperimentAssignment({
    required this.projectId,
    required this.environmentId,
    required this.experimentVersionId,
    required this.variantId,
    required this.allocationVersion,
    required this.assignmentKeyType,
    required this.subjectDigest,
    required this.bucket,
    required this.assignedAt,
    required this.groupVersionId,
    required this.exposed,
  });
  final String projectId;
  final String environmentId;
  final String experimentVersionId;
  final String variantId;
  final String allocationVersion;
  final String assignmentKeyType;
  final String subjectDigest;
  final int bucket;
  final DateTime assignedAt;
  final String? groupVersionId;
  final bool exposed;

  Map<String, Object?> toJson() => {
        'projectId': projectId,
        'environmentId': environmentId,
        'experimentVersionId': experimentVersionId,
        'variantId': variantId,
        'allocationVersion': allocationVersion,
        'assignmentKeyType': assignmentKeyType,
        'subjectDigest': subjectDigest,
        'bucket': bucket,
        'algorithm': mosaicExperimentBucketingAlgorithm,
        'assignedAt': assignedAt.toUtc().toIso8601String(),
        if (groupVersionId != null) 'groupVersionId': groupVersionId,
        'exposed': exposed,
      };
}

abstract interface class MosaicExperimentAssignmentStorage {
  Future<String?> read(String namespace);
  Future<void> write(String namespace, String source);
}

final class MosaicMemoryExperimentAssignmentStorage
    implements MosaicExperimentAssignmentStorage {
  String? source;
  @override
  Future<String?> read(String namespace) async => source;
  @override
  Future<void> write(String namespace, String source) async =>
      this.source = source;
}

final class MosaicFileExperimentAssignmentStorage
    implements MosaicExperimentAssignmentStorage {
  const MosaicFileExperimentAssignmentStorage();
  Future<File> _file(String namespace) async {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(namespace)) {
      throw ArgumentError.value(namespace, 'namespace');
    }
    final directory = await getApplicationCacheDirectory();
    return File(
        '${directory.path}/mosaic/experiment-assignments-$namespace.json');
  }

  @override
  Future<String?> read(String namespace) async {
    final file = await _file(namespace);
    if (!await file.exists()) return null;
    if ((await file.length()) > 256 * 1024)
      throw const FormatException('Assignment store is too large.');
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
    } finally {
      if (await temporary.exists()) await temporary.delete();
    }
  }
}

final class MosaicExperimentAssignmentStore {
  MosaicExperimentAssignmentStore(
      {required this.storage, required this.namespace});
  final MosaicExperimentAssignmentStorage storage;
  final String namespace;
  Future<void> _serial = Future.value();

  Future<List<Map<String, Object?>>> read({DateTime? now}) async {
    try {
      final source = await storage.read(namespace);
      if (source == null) return [];
      final value = jsonDecode(source);
      if (value is! List) return [];
      final cutoff =
          (now ?? DateTime.now()).toUtc().subtract(mosaicAssignmentRetention);
      return value
          .whereType<Map<Object?, Object?>>()
          .map((e) => e.cast<String, Object?>())
          .where((e) {
            final assigned =
                DateTime.tryParse(e['assignedAt'] as String? ?? '');
            return assigned != null && !assigned.toUtc().isBefore(cutoff);
          })
          .take(mosaicMaximumPersistedAssignments)
          .toList();
    } on Object {
      return [];
    }
  }

  Future<void> record(MosaicExperimentAssigned result, String assignmentValue,
      {DateTime? now}) {
    final completion = _serial.then((_) async {
      final records = await read(now: now);
      final subjectDigest = 'sha256:${mosaicSha256String(assignmentValue)}';
      records.removeWhere((e) =>
          e['projectId'] == result.assignment.projectId &&
          e['environmentId'] == result.assignment.environmentId &&
          e['experimentVersionId'] == result.assignment.experimentVersionId &&
          e['assignmentKeyType'] == result.assignmentKeyType &&
          e['subjectDigest'] == subjectDigest);
      records.insert(
          0,
          MosaicPersistedExperimentAssignment(
            projectId: result.assignment.projectId,
            environmentId: result.assignment.environmentId,
            experimentVersionId: result.assignment.experimentVersionId,
            variantId: result.variant.id,
            allocationVersion: result.assignment.allocationVersion,
            assignmentKeyType: result.assignmentKeyType,
            subjectDigest: subjectDigest,
            bucket: result.bucket,
            assignedAt: (now ?? DateTime.now()).toUtc(),
            groupVersionId: result.assignment.group?.versionId,
            exposed: false,
          ).toJson());
      await storage.write(namespace,
          jsonEncode(records.take(mosaicMaximumPersistedAssignments).toList()));
    });
    _serial = completion.catchError((Object _) {});
    return completion;
  }

  Future<void> markExposed(
      MosaicExperimentAssigned result, String assignmentValue) {
    final completion = _serial.then((_) async {
      final records = await read();
      final digest = 'sha256:${mosaicSha256String(assignmentValue)}';
      for (final record in records) {
        if (record['experimentVersionId'] ==
                result.assignment.experimentVersionId &&
            record['assignmentKeyType'] == result.assignmentKeyType &&
            record['subjectDigest'] == digest) {
          record['exposed'] = true;
          break;
        }
      }
      await storage.write(namespace, jsonEncode(records));
    });
    _serial = completion.catchError((Object _) {});
    return completion;
  }
}
