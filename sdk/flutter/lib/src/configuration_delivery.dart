import 'dart:collection';
import 'dart:convert';

import 'experiment_assignment.dart';
import 'placement_decision.dart';
import 'protocol.dart';
import 'sha256.dart';

/// The Configuration Delivery contract version, and the only one this SDK
/// reads. It carries Paywall Protocol [mosaicProtocolVersion].
const String mosaicConfigurationDeliveryVersion = '3';
const int mosaicMaximumConfigurationBytes = 8 * 1024 * 1024;

final class MosaicConfigurationDeliveryException implements Exception {
  const MosaicConfigurationDeliveryException(this.message);

  final String message;

  @override
  String toString() => 'MosaicConfigurationDeliveryException: $message';
}

final class _MosaicReleaseCompatibility {
  _MosaicReleaseCompatibility({
    required Iterable<String> requiredFeatures,
    required Iterable<String> bucketingAlgorithms,
    required Iterable<MosaicRequiredCapability> paywallCapabilities,
    required Iterable<String> experimentFeatures,
    required Iterable<String> experimentAlgorithms,
    required Iterable<String> experimentSchedulePolicies,
  })  : requiredFeatures = Set.unmodifiable(requiredFeatures),
        bucketingAlgorithms = Set.unmodifiable(bucketingAlgorithms),
        paywallCapabilities = List.unmodifiable(paywallCapabilities),
        experimentFeatures = Set.unmodifiable(experimentFeatures),
        experimentAlgorithms = Set.unmodifiable(experimentAlgorithms),
        experimentSchedulePolicies =
            Set.unmodifiable(experimentSchedulePolicies);

  final Set<String> requiredFeatures;
  final Set<String> bucketingAlgorithms;
  final List<MosaicRequiredCapability> paywallCapabilities;
  final Set<String> experimentFeatures;
  final Set<String> experimentAlgorithms;
  final Set<String> experimentSchedulePolicies;
}

final class MosaicConfigurationDeliveryEnvelope {
  const MosaicConfigurationDeliveryEnvelope({
    required this.version,
    required this.release,
    required this.source,
  });

  final String version;
  final MosaicConfigurationRelease release;
  final String source;
}

final class MosaicConfigurationRelease {
  MosaicConfigurationRelease({
    required this.id,
    required this.number,
    required this.environment,
    required this.publishedAt,
    required this.contentDigest,
    required Iterable<MosaicRequiredCapability> requiredCapabilities,
    required Map<String, MosaicDeliveredPaywallVersion> paywallVersions,
    required Map<String, MosaicDeliveredProductReference> productReferences,
    required Map<String, MosaicDeliveredAssetReference> assetReferences,
    this.projectId,
    Map<String, MosaicPlacementRuleSet> placementDecisions = const {},
    Map<String, MosaicDeliveredEntitlementReference> entitlementReferences =
        const {},
    Iterable<MosaicExperimentAssignment> experimentAssignments = const [],
  })  : requiredCapabilities = List.unmodifiable(requiredCapabilities),
        paywallVersions = Map.unmodifiable(paywallVersions),
        productReferences = Map.unmodifiable(productReferences),
        assetReferences = Map.unmodifiable(assetReferences),
        placementDecisions = Map.unmodifiable(placementDecisions),
        entitlementReferences = Map.unmodifiable(entitlementReferences),
        experimentAssignments = List.unmodifiable(
          experimentAssignments.toList()
            ..sort((left, right) =>
                left.experimentId.compareTo(right.experimentId)),
        );

  final String id;
  final int number;
  final MosaicDeliveredEnvironment environment;
  final String publishedAt;
  final String contentDigest;
  final String? projectId;
  final List<MosaicRequiredCapability> requiredCapabilities;
  final Map<String, MosaicDeliveredPaywallVersion> paywallVersions;
  final Map<String, MosaicDeliveredProductReference> productReferences;
  final Map<String, MosaicDeliveredAssetReference> assetReferences;
  final Map<String, MosaicPlacementRuleSet> placementDecisions;
  final Map<String, MosaicDeliveredEntitlementReference> entitlementReferences;

  /// Canonical Experiment candidates ordered by stable Experiment ID.
  final List<MosaicExperimentAssignment> experimentAssignments;

  MosaicPlacementRuleSet? decisionForPlacement(String key) =>
      placementDecisions[key];

  List<MosaicExperimentAssignment> experimentsForPlacement(
    String placementId,
  ) =>
      List.unmodifiable(
        experimentAssignments.where(
          (assignment) => assignment.placementId == placementId,
        ),
      );
}

enum MosaicDeliveredEnvironmentMode { development, staging, production }

final class MosaicDeliveredEnvironment {
  const MosaicDeliveredEnvironment({
    required this.id,
    required this.key,
    this.mode,
  });

  final String id;
  final String key;
  final MosaicDeliveredEnvironmentMode? mode;
}

final class MosaicDeliveredPaywallVersion {
  MosaicDeliveredPaywallVersion({
    required this.id,
    required this.paywallId,
    required this.protocolVersion,
    required this.documentDigest,
    required this.document,
    required Iterable<String> productReferenceIds,
    required Map<String, String> assetBindings,
  })  : productReferenceIds = Set.unmodifiable(productReferenceIds),
        assetBindings = Map.unmodifiable(assetBindings);

  final String id;
  final String paywallId;
  final String protocolVersion;
  final String documentDigest;
  final MosaicPaywallDocument document;
  final Set<String> productReferenceIds;
  final Map<String, String> assetBindings;
}

enum MosaicDeliveredProductType { subscription, oneTimeNonConsumable }

enum MosaicDeliveredProductReadiness { ready, notReady }

final class MosaicDeliveredProductReference {
  const MosaicDeliveredProductReference({
    required this.id,
    required this.type,
    required this.fallbackDisplayName,
    this.readiness,
  });

  final String id;
  final MosaicDeliveredProductType type;
  final String fallbackDisplayName;
  final MosaicDeliveredProductReadiness? readiness;
}

final class MosaicDeliveredEntitlementReference {
  const MosaicDeliveredEntitlementReference(
      {required this.id, required this.key});
  final String id;
  final String key;
}

enum MosaicDeliveredAssetKind { image, video }

final class MosaicDeliveredAssetReference {
  const MosaicDeliveredAssetReference({
    required this.id,
    required this.kind,
    required this.mediaType,
    required this.byteLength,
    required this.contentDigest,
    required this.url,
  });

  final String id;
  final MosaicDeliveredAssetKind kind;
  final String mediaType;
  final int byteLength;
  final String contentDigest;
  final Uri url;
}

/// Strict, atomic reader for the Configuration Delivery contract.
///
/// Every included Protocol [mosaicProtocolVersion] document and every
/// cross-release reference is validated before an envelope is returned.
final class MosaicConfigurationDeliveryDecoder {
  const MosaicConfigurationDeliveryDecoder({
    this.protocolDecoder = const MosaicProtocolDecoder(),
  });

  final MosaicProtocolDecoder protocolDecoder;

  MosaicConfigurationDeliveryEnvelope decode(String source) {
    if (utf8.encode(source).length > mosaicMaximumConfigurationBytes) {
      throw const MosaicConfigurationDeliveryException(
        'The configuration release exceeds the SDK byte limit.',
      );
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException {
      throw const MosaicConfigurationDeliveryException(
        'The configuration release is not valid JSON.',
      );
    }
    final envelope = _object(decoded, r'$');
    _expectKeys(
      envelope,
      const <String>{'configurationDeliveryVersion', 'release'},
      r'$',
    );
    final version = _string(
      envelope['configurationDeliveryVersion'],
      r'$.configurationDeliveryVersion',
    );
    if (version != mosaicConfigurationDeliveryVersion) {
      throw const MosaicConfigurationDeliveryException(
        'The Configuration Delivery version is unsupported.',
      );
    }
    final releaseObject = _object(envelope['release'], r'$.release');
    final release = _release(releaseObject);
    _validateReleaseDigest(envelope, release.contentDigest);
    return MosaicConfigurationDeliveryEnvelope(
      version: version,
      release: release,
      source: source,
    );
  }

  MosaicConfigurationRelease _release(Map<String, Object?> object) {
    const path = r'$.release';
    _expectKeys(
      object,
      const <String>{
        'id',
        'number',
        'projectId',
        'environment',
        'publishedAt',
        'contentDigest',
        'compatibility',
        'placementDecisions',
        'paywallVersions',
        'productReferences',
        'entitlementReferences',
        'assetReferences',
        'experimentAssignments',
      },
      path,
    );
    final projectId = _identifier(object['projectId'], '$path.projectId');
    final environmentObject =
        _object(object['environment'], '$path.environment');
    _expectKeys(
        environmentObject, const {'id', 'key', 'mode'}, '$path.environment');
    final environmentMode = switch (_string(
      environmentObject['mode'],
      '$path.environment.mode',
    )) {
      'development' => MosaicDeliveredEnvironmentMode.development,
      'staging' => MosaicDeliveredEnvironmentMode.staging,
      'production' => MosaicDeliveredEnvironmentMode.production,
      _ => throw const MosaicConfigurationDeliveryException(
          'The release Environment mode is invalid.'),
    };
    final environment = MosaicDeliveredEnvironment(
      id: _identifier(environmentObject['id'], '$path.environment.id'),
      key: _patternString(environmentObject['key'], '$path.environment.key',
          _environmentKeyPattern,
          maximumLength: 64),
      mode: environmentMode,
    );
    final compatibility = _compatibility(object['compatibility']);
    final assets = _assetReferences(object['assetReferences']);
    final paywalls = _paywallVersions(
      object['paywallVersions'],
      assets,
      allowEmpty: true,
    );
    final products = _productReferences(object['productReferences']);
    final entitlements =
        _entitlementReferences(object['entitlementReferences']);
    final decisions = <String, MosaicPlacementRuleSet>{};
    final entries = _list(
        object['placementDecisions'], '$path.placementDecisions',
        minimum: 1, maximum: 256);
    for (var index = 0; index < entries.length; index += 1) {
      final MosaicPlacementRuleSet decision;
      try {
        decision =
            const MosaicPlacementDecisionDecoder().decode(entries[index]);
      } on MosaicPlacementDecisionException {
        throw const MosaicConfigurationDeliveryException(
          'The release contains an invalid Placement Decision.',
        );
      }
      if (decision.projectId != projectId ||
          decision.environmentId != environment.id ||
          decision.environmentKey != environment.key ||
          decisions.containsKey(decision.placementKey)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains inconsistent Placement Decision identity.',
        );
      }
      decisions[decision.placementKey] = decision;
    }
    if (environmentMode == MosaicDeliveredEnvironmentMode.production &&
        decisions.values.any((decision) => decision.qaOverrides.isNotEmpty)) {
      throw const MosaicConfigurationDeliveryException(
        'Production releases cannot contain QA overrides.',
      );
    }
    final embeddedFeatures = <String>{
      for (final decision in decisions.values) ...decision.requiredFeatures,
    };
    final embeddedAlgorithms = <String>{
      for (final decision in decisions.values) ...decision.bucketingAlgorithms,
    };
    if (!_sameSet(compatibility.requiredFeatures, embeddedFeatures) ||
        !_sameSet(compatibility.bucketingAlgorithms, embeddedAlgorithms)) {
      throw const MosaicConfigurationDeliveryException(
        'Release decision compatibility must exactly match embedded requirements.',
      );
    }
    _validateReferences(decisions, paywalls, products, entitlements);
    final assignments = _experimentAssignments(
      object['experimentAssignments'],
      projectId: projectId,
      environment: environment,
      decisions: decisions,
      paywalls: paywalls,
    );
    _validateExperimentCompatibility(compatibility, assignments);
    return MosaicConfigurationRelease(
      id: _identifier(object['id'], '$path.id'),
      number:
          _integer(object['number'], '$path.number', maximum: 9007199254740991),
      projectId: projectId,
      environment: environment,
      publishedAt: _timestamp(object['publishedAt'], '$path.publishedAt'),
      contentDigest: _digest(object['contentDigest'], '$path.contentDigest'),
      requiredCapabilities: compatibility.paywallCapabilities,
      placementDecisions: decisions,
      paywallVersions: paywalls,
      productReferences: products,
      entitlementReferences: entitlements,
      assetReferences: assets,
      experimentAssignments: assignments,
    );
  }

  List<MosaicExperimentAssignment> _experimentAssignments(
    Object? value, {
    required String projectId,
    required MosaicDeliveredEnvironment environment,
    required Map<String, MosaicPlacementRuleSet> decisions,
    required Map<String, MosaicDeliveredPaywallVersion> paywalls,
  }) {
    final values =
        _list(value, r'$.release.experimentAssignments', maximum: 128);
    final assignments = <MosaicExperimentAssignment>[];
    final experimentIds = <String>{};
    final experimentVersionIds = <String>{};
    for (final source in values) {
      final MosaicExperimentAssignment assignment;
      try {
        assignment = const MosaicExperimentAssignmentDecoder().decodeEmbedded(
            source,
            production:
                environment.mode == MosaicDeliveredEnvironmentMode.production);
      } on FormatException {
        throw const MosaicConfigurationDeliveryException(
          'The release contains an invalid Experiment Assignment.',
        );
      }
      if (assignment.projectId != projectId ||
          assignment.environmentId != environment.id ||
          !experimentIds.add(assignment.experimentId) ||
          !experimentVersionIds.add(assignment.experimentVersionId) ||
          !_placementContainsControlOutcome(decisions.values,
              assignment.placementId, assignment.controlPaywallVersionId) ||
          assignment.variants.any((variant) {
            final paywall = paywalls[variant.paywallVersionId];
            return paywall?.paywallId != variant.paywallId ||
                !_sameSet(
                  paywall!.productReferenceIds,
                  variant.requiredProductIds,
                );
          }) ||
          assignment.group != null &&
              !assignment.group!.members.any(
                  (member) => member.experimentId == assignment.experimentId)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains inconsistent Experiment references.',
        );
      }
      assignments.add(assignment);
    }
    return assignments;
  }

  /// The declared Experiment compatibility must match what is embedded exactly:
  /// an over-declaration claims a feature nothing needs, and an
  /// under-declaration hides one a reader must have.
  void _validateExperimentCompatibility(
    _MosaicReleaseCompatibility compatibility,
    List<MosaicExperimentAssignment> assignments,
  ) {
    final requiredFeatures = <String>{};
    final requiredAlgorithms = <String>{};
    for (final assignment in assignments) {
      requiredFeatures.addAll({
        'allocation.ranges',
        'fallback.normal_placement',
        'schedule.trusted_server_time',
        'assignment.${switch (assignment.assignmentPolicy) {
          MosaicExperimentAssignmentPolicy.installation => 'installation',
          MosaicExperimentAssignmentPolicy.identifiedUser => 'identified_user',
          MosaicExperimentAssignmentPolicy.identifiedUserOrInstallation =>
            'identified_user_or_installation',
        }}',
        if (assignment.group != null) 'group.mutual_exclusion',
        if (assignment.qaOverrides.isNotEmpty) 'override.qa',
      });
      requiredAlgorithms.add(mosaicExperimentBucketingAlgorithm);
      if (assignment.group != null) {
        requiredAlgorithms.add(mosaicExperimentGroupBucketingAlgorithm);
      }
    }
    if (!_sameSet(compatibility.experimentFeatures, requiredFeatures) ||
        !_sameSet(compatibility.experimentAlgorithms, requiredAlgorithms) ||
        !_sameSet(
            compatibility.experimentSchedulePolicies,
            assignments.isEmpty
                ? const <String>{}
                : const {mosaicExperimentSchedulePolicy})) {
      throw const MosaicConfigurationDeliveryException(
        'Release Experiment compatibility must exactly match embedded requirements.',
      );
    }
  }

  _MosaicReleaseCompatibility _compatibility(Object? value) {
    const path = r'$.release.compatibility';
    final object = _object(value, path);
    _expectKeys(
        object,
        const {
          'placementDecisionContracts',
          'paywallProtocols',
          'acceptance',
          'experimentAssignmentContracts',
        },
        path);
    if (_string(object['acceptance'], '$path.acceptance') != 'atomic') {
      throw const MosaicConfigurationDeliveryException(
        'Configuration releases must use atomic acceptance.',
      );
    }
    final decisions = _list(object['placementDecisionContracts'],
        '$path.placementDecisionContracts',
        minimum: 1, maximum: 1);
    final decision =
        _object(decisions.single, '$path.placementDecisionContracts[0]');
    _expectKeys(
        decision,
        const {'version', 'requiredFeatures', 'bucketingAlgorithms'},
        '$path.placementDecisionContracts[0]');
    if (_string(decision['version'],
            '$path.placementDecisionContracts[0].version') !=
        '1') {
      throw const MosaicConfigurationDeliveryException(
          'Unsupported decision contract.');
    }
    final features = _uniqueStrings(decision['requiredFeatures'],
        '$path.placementDecisionContracts[0].requiredFeatures',
        maximum: 64);
    if (!mosaicDecisionFeatures.containsAll(features)) {
      throw const MosaicConfigurationDeliveryException(
          'Unsupported decision feature.');
    }
    final algorithms = _uniqueStrings(decision['bucketingAlgorithms'],
        '$path.placementDecisionContracts[0].bucketingAlgorithms',
        maximum: 1);
    if (algorithms.any((value) => value != mosaicRolloutAlgorithm)) {
      throw const MosaicConfigurationDeliveryException(
          'Unsupported rollout algorithm.');
    }
    const experimentPath = '$path.experimentAssignmentContracts';
    final experiments = _list(
        object['experimentAssignmentContracts'], experimentPath,
        minimum: 1, maximum: 1);
    final experiment = _object(experiments.single, '$experimentPath[0]');
    _expectKeys(
        experiment,
        const {
          'version',
          'requiredFeatures',
          'bucketingAlgorithms',
          'schedulePolicies',
        },
        '$experimentPath[0]');
    if (_string(experiment['version'], '$experimentPath[0].version') != '1') {
      throw const MosaicConfigurationDeliveryException(
          'Unsupported Experiment contract.');
    }
    Set<String> strings(String key) =>
        _list(experiment[key], '$experimentPath[0].$key', maximum: 16)
            .map((item) => _string(item, '$experimentPath[0].$key'))
            .toSet();
    return _MosaicReleaseCompatibility(
      requiredFeatures: features,
      bucketingAlgorithms: algorithms,
      paywallCapabilities: _paywallCapabilities(object),
      experimentFeatures: strings('requiredFeatures'),
      experimentAlgorithms: strings('bucketingAlgorithms'),
      experimentSchedulePolicies: strings('schedulePolicies'),
    );
  }

  /// The paywall-protocol arm of an already key-checked compatibility object.
  List<MosaicRequiredCapability> _paywallCapabilities(
    Map<String, Object?> object,
  ) {
    const path = r'$.release.compatibility';
    final protocols = _list(
      object['paywallProtocols'],
      '$path.paywallProtocols',
      minimum: 1,
      maximum: 1,
    );
    final protocol = _object(protocols.single, '$path.paywallProtocols[0]');
    _expectKeys(
      protocol,
      const <String>{'version', 'requiredCapabilities'},
      '$path.paywallProtocols[0]',
    );
    if (_string(protocol['version'], '$path.paywallProtocols[0].version') !=
        mosaicProtocolVersion) {
      throw const MosaicConfigurationDeliveryException(
        'The release requires an unsupported Paywall Protocol.',
      );
    }
    final entries = _list(
      protocol['requiredCapabilities'],
      '$path.paywallProtocols[0].requiredCapabilities',
      minimum: 0,
      maximum: 128,
    );
    final seen = <String>{};
    return <MosaicRequiredCapability>[
      for (var index = 0; index < entries.length; index += 1)
        _requiredCapability(
          entries[index],
          '$path.paywallProtocols[0].requiredCapabilities[$index]',
          seen,
        ),
    ];
  }

  MosaicRequiredCapability _requiredCapability(
    Object? value,
    String path,
    Set<String> seen,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'name', 'version'}, path);
    final name = _string(object['name'], '$path.name');
    final version = _string(object['version'], '$path.version');
    if (!mosaicProtocolCapabilities.contains(name) ||
        version != mosaicProtocolVersion) {
      throw const MosaicConfigurationDeliveryException(
        'The release requires an unsupported Paywall capability.',
      );
    }
    if (!seen.add(name)) {
      throw const MosaicConfigurationDeliveryException(
        'The release contains a duplicate Paywall capability.',
      );
    }
    return MosaicRequiredCapability(name: name, version: version);
  }

  Map<String, MosaicDeliveredPaywallVersion> _paywallVersions(
    Object? value,
    Map<String, MosaicDeliveredAssetReference> assetReferences, {
    bool allowEmpty = false,
  }) {
    const path = r'$.release.paywallVersions';
    final entries =
        _list(value, path, minimum: allowEmpty ? 0 : 1, maximum: 256);
    final result = <String, MosaicDeliveredPaywallVersion>{};
    final paywallIds = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(
        object,
        const <String>{
          'id',
          'paywallId',
          'protocolVersion',
          'documentDigest',
          'document',
          'productReferenceIds',
          'assetBindings',
        },
        entryPath,
      );
      final id = _identifier(object['id'], '$entryPath.id');
      final paywallId =
          _identifier(object['paywallId'], '$entryPath.paywallId');
      if (result.containsKey(id) || !paywallIds.add(paywallId)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains duplicate Paywall Versions.',
        );
      }
      final protocolVersion =
          _string(object['protocolVersion'], '$entryPath.protocolVersion');
      if (protocolVersion != mosaicProtocolVersion) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version uses an unsupported protocol.',
        );
      }
      final documentObject = _object(object['document'], '$entryPath.document');
      final documentSource = jsonEncode(documentObject);
      final MosaicPaywallDocument document;
      try {
        document = protocolDecoder.decode(documentSource);
      } on MosaicProtocolException {
        throw const MosaicConfigurationDeliveryException(
          'An included Paywall document is invalid or unsupported.',
        );
      }
      if (document.schemaVersion != protocolVersion ||
          document.id != paywallId) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version does not match its document identity.',
        );
      }
      final documentDigest =
          _digest(object['documentDigest'], '$entryPath.documentDigest');
      if (documentDigest != _digestValue(documentObject)) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version document digest does not match.',
        );
      }
      final productIds = _uniqueIdentifiers(
        object['productReferenceIds'],
        '$entryPath.productReferenceIds',
        maximum: 64,
      );
      if (!_sameSet(
          productIds, document.products.map((item) => item.productId))) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version Product reference set is inconsistent.',
        );
      }
      final bindings = _assetBindings(
        object['assetBindings'],
        entryPath,
        document,
        assetReferences,
      );
      result[id] = MosaicDeliveredPaywallVersion(
        id: id,
        paywallId: paywallId,
        protocolVersion: protocolVersion,
        documentDigest: documentDigest,
        document: document,
        productReferenceIds: productIds,
        assetBindings: bindings,
      );
    }
    return result;
  }

  Map<String, String> _assetBindings(
    Object? value,
    String versionPath,
    MosaicPaywallDocument document,
    Map<String, MosaicDeliveredAssetReference> assetReferences,
  ) {
    final path = '$versionPath.assetBindings';
    final entries = _list(value, path, maximum: 128);
    final result = <String, String>{};
    final referencedIds = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(
        object,
        const <String>{'documentAssetId', 'assetReferenceId'},
        entryPath,
      );
      final documentId =
          _identifier(object['documentAssetId'], '$entryPath.documentAssetId');
      final referenceId = _identifier(
          object['assetReferenceId'], '$entryPath.assetReferenceId');
      if (result.containsKey(documentId) || !referencedIds.add(referenceId)) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version contains duplicate Asset bindings.',
        );
      }
      result[documentId] = referenceId;
    }
    final remoteAssets = <String, MosaicAsset>{
      for (final asset in document.assets)
        if (asset.source is MosaicRemoteAssetSource) asset.id: asset,
    };
    if (!_sameSet(result.keys, remoteAssets.keys)) {
      throw const MosaicConfigurationDeliveryException(
        'A Paywall Version remote Asset binding set is inconsistent.',
      );
    }
    for (final binding in result.entries) {
      final documentAsset = remoteAssets[binding.key]!;
      final releaseAsset = assetReferences[binding.value];
      if (releaseAsset == null) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version references an unknown release Asset.',
        );
      }
      final documentKind = documentAsset is MosaicImageAsset
          ? MosaicDeliveredAssetKind.image
          : MosaicDeliveredAssetKind.video;
      final documentUrl = (documentAsset.source as MosaicRemoteAssetSource).url;
      if (releaseAsset.kind != documentKind ||
          releaseAsset.url != documentUrl) {
        throw const MosaicConfigurationDeliveryException(
          'A release Asset does not match its Paywall document Asset.',
        );
      }
    }
    return result;
  }

  Map<String, MosaicDeliveredProductReference> _productReferences(
      Object? value) {
    const path = r'$.release.productReferences';
    final entries = _list(value, path, maximum: 1024);
    final result = <String, MosaicDeliveredProductReference>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(object,
          const {'id', 'type', 'fallbackDisplayName', 'readiness'}, entryPath);
      final id = _identifier(object['id'], '$entryPath.id');
      if (result.containsKey(id)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains a duplicate Product reference.',
        );
      }
      final type = _string(object['type'], '$entryPath.type');
      final readiness = _string(object['readiness'], '$entryPath.readiness');
      result[id] = MosaicDeliveredProductReference(
        id: id,
        type: switch (type) {
          'subscription' => MosaicDeliveredProductType.subscription,
          'one_time_non_consumable' =>
            MosaicDeliveredProductType.oneTimeNonConsumable,
          _ => throw const MosaicConfigurationDeliveryException(
              'A Product reference uses an unsupported type.'),
        },
        fallbackDisplayName: _boundedSafeString(
          object['fallbackDisplayName'],
          '$entryPath.fallbackDisplayName',
          maximumLength: 160,
        ),
        readiness: switch (readiness) {
          'ready' => MosaicDeliveredProductReadiness.ready,
          'not_ready' => MosaicDeliveredProductReadiness.notReady,
          _ => throw const MosaicConfigurationDeliveryException(
              'A Product reference uses invalid readiness.'),
        },
      );
    }
    return result;
  }

  Map<String, MosaicDeliveredEntitlementReference> _entitlementReferences(
      Object? value) {
    const path = r'$.release.entitlementReferences';
    final entries = _list(value, path, maximum: 1024);
    final result = <String, MosaicDeliveredEntitlementReference>{};
    final keys = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(object, const {'id', 'key'}, entryPath);
      final id = _identifier(object['id'], '$entryPath.id');
      final key = _patternString(
          object['key'], '$entryPath.key', _placementKeyPattern,
          maximumLength: 64);
      if (result.containsKey(id) || !keys.add(key)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains duplicate Entitlement references.',
        );
      }
      result[id] = MosaicDeliveredEntitlementReference(id: id, key: key);
    }
    return result;
  }

  void _validateReferences(
    Map<String, MosaicPlacementRuleSet> decisions,
    Map<String, MosaicDeliveredPaywallVersion> paywalls,
    Map<String, MosaicDeliveredProductReference> products,
    Map<String, MosaicDeliveredEntitlementReference> entitlements,
  ) {
    final entitlementKeys =
        entitlements.values.map((value) => value.key).toSet();
    void outcome(MosaicDecisionOutcome value) {
      if (value is MosaicPaywallDecisionOutcome &&
          !paywalls.containsKey(value.paywallVersionId)) {
        throw const MosaicConfigurationDeliveryException(
          'A Placement outcome references an unknown Paywall Version.',
        );
      }
    }

    void conditions(MosaicConditionNode value) {
      if (value is MosaicConditionLeaf) {
        if ((value.sourceKind == 'product_availability' ||
                value.sourceKind == 'product_readiness') &&
            !products.containsKey(value.sourceKey)) {
          throw const MosaicConfigurationDeliveryException(
            'A condition references an unknown Product.',
          );
        }
        if (value.sourceKind == 'entitlement_state' &&
            !entitlementKeys.contains(value.sourceKey)) {
          throw const MosaicConfigurationDeliveryException(
            'A condition references an unknown Entitlement.',
          );
        }
      } else if (value is MosaicConditionNot) {
        conditions(value.child);
      } else {
        for (final child in (value as MosaicConditionGroup).children) {
          conditions(child);
        }
      }
    }

    for (final decision in decisions.values) {
      outcome(decision.defaultOutcome);
      for (final fallback in decision.fallbacks.values)
        outcome(fallback.outcome);
      for (final rule in decision.rules) {
        outcome(rule.outcome);
        conditions(rule.conditions);
      }
      for (final override in decision.qaOverrides) outcome(override.outcome);
    }
    for (final paywall in paywalls.values) {
      if (!products.keys.toSet().containsAll(paywall.productReferenceIds)) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall references an unknown Product.',
        );
      }
    }
  }

  bool _placementContainsControlOutcome(
    Iterable<MosaicPlacementRuleSet> decisions,
    String placementId,
    String controlPaywallVersionId,
  ) {
    bool matches(MosaicDecisionOutcome outcome) =>
        outcome is MosaicPaywallDecisionOutcome &&
        outcome.paywallVersionId == controlPaywallVersionId;

    for (final decision in decisions) {
      if (decision.placementId != placementId) continue;
      if (matches(decision.defaultOutcome) ||
          decision.rules.any((rule) => matches(rule.outcome)) ||
          decision.fallbacks.values
              .any((fallback) => matches(fallback.outcome)) ||
          decision.qaOverrides.any((override) => matches(override.outcome))) {
        return true;
      }
    }
    return false;
  }

  Map<String, MosaicDeliveredAssetReference> _assetReferences(Object? value) {
    const path = r'$.release.assetReferences';
    final entries = _list(value, path, maximum: 1024);
    final result = <String, MosaicDeliveredAssetReference>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(
        object,
        const <String>{
          'id',
          'kind',
          'mediaType',
          'byteLength',
          'contentDigest',
          'url',
        },
        entryPath,
      );
      final id = _identifier(object['id'], '$entryPath.id');
      if (result.containsKey(id)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains a duplicate Asset reference.',
        );
      }
      final kindValue = _string(object['kind'], '$entryPath.kind');
      final kind = switch (kindValue) {
        'image' => MosaicDeliveredAssetKind.image,
        'video' => MosaicDeliveredAssetKind.video,
        _ => throw const MosaicConfigurationDeliveryException(
            'A release Asset uses an unsupported kind.',
          ),
      };
      final mediaType = _patternString(
        object['mediaType'],
        '$entryPath.mediaType',
        _mediaTypePattern,
        maximumLength: 96,
      );
      if (!mediaType.startsWith('$kindValue/')) {
        throw const MosaicConfigurationDeliveryException(
          'A release Asset media type does not match its kind.',
        );
      }
      result[id] = MosaicDeliveredAssetReference(
        id: id,
        kind: kind,
        mediaType: mediaType,
        byteLength: _integer(
          object['byteLength'],
          '$entryPath.byteLength',
          maximum: 52428800,
        ),
        contentDigest:
            _digest(object['contentDigest'], '$entryPath.contentDigest'),
        url: _immutableHttpsUrl(object['url'], '$entryPath.url'),
      );
    }
    return result;
  }

  void _validateReleaseDigest(
    Map<String, Object?> envelope,
    String expected,
  ) {
    final release = Map<String, Object?>.from(
      _object(envelope['release'], r'$.release'),
    )..remove('contentDigest');
    if (_digestValue(release) != expected) {
      throw const MosaicConfigurationDeliveryException(
        'The release content digest does not match.',
      );
    }
  }
}

Object? _canonicalize(Object? value) {
  if (value is List<Object?>) {
    return <Object?>[for (final item in value) _canonicalize(item)];
  }
  if (value is Map) {
    final sorted = SplayTreeMap<String, Object?>();
    for (final entry in value.entries) {
      sorted[entry.key as String] = _canonicalize(entry.value);
    }
    return sorted;
  }
  return value;
}

String _digestValue(Object? value) =>
    'sha256:${mosaicSha256String(jsonEncode(_canonicalize(value)))}';

Map<String, Object?> _object(Object? value, String path) {
  if (value is! Map) {
    throw MosaicConfigurationDeliveryException('Expected an object at $path.');
  }
  try {
    return value.cast<String, Object?>();
  } on Object {
    throw MosaicConfigurationDeliveryException('Expected an object at $path.');
  }
}

List<Object?> _list(
  Object? value,
  String path, {
  int minimum = 0,
  required int maximum,
}) {
  if (value is! List<Object?> ||
      value.length < minimum ||
      value.length > maximum) {
    throw MosaicConfigurationDeliveryException('Invalid list at $path.');
  }
  return value;
}

Set<String> _uniqueStrings(
  Object? value,
  String path, {
  required int maximum,
}) {
  final entries = _list(value, path, maximum: maximum);
  final result = <String>{};
  for (var index = 0; index < entries.length; index += 1) {
    final item = _string(entries[index], '$path[$index]');
    if (!result.add(item)) {
      throw MosaicConfigurationDeliveryException('Duplicate string at $path.');
    }
  }
  return result;
}

void _expectKeys(
  Map<String, Object?> object,
  Set<String> expected,
  String path,
) {
  if (object.keys.toSet().difference(expected).isNotEmpty ||
      expected.difference(object.keys.toSet()).isNotEmpty) {
    throw MosaicConfigurationDeliveryException('Unexpected fields at $path.');
  }
}

String _string(Object? value, String path) {
  if (value is! String) {
    throw MosaicConfigurationDeliveryException('Expected a string at $path.');
  }
  return value;
}

String _patternString(
  Object? value,
  String path,
  RegExp pattern, {
  required int maximumLength,
}) {
  final source = _string(value, path);
  if (source.isEmpty ||
      source.length > maximumLength ||
      !pattern.hasMatch(source)) {
    throw MosaicConfigurationDeliveryException('Invalid string at $path.');
  }
  return source;
}

String _boundedSafeString(
  Object? value,
  String path, {
  required int maximumLength,
}) {
  final source = _string(value, path);
  if (source.isEmpty ||
      source.length > maximumLength ||
      source.runes.any((rune) => rune < 0x20 || rune == 0x7f)) {
    throw MosaicConfigurationDeliveryException('Invalid string at $path.');
  }
  return source;
}

String _identifier(Object? value, String path) => _patternString(
      value,
      path,
      _identifierPattern,
      maximumLength: 128,
    );

int _integer(Object? value, String path, {required int maximum}) {
  if (value is! num ||
      !value.isFinite ||
      value < 1 ||
      value > maximum ||
      value != value.truncate()) {
    throw MosaicConfigurationDeliveryException('Invalid integer at $path.');
  }
  return value.toInt();
}

String _digest(Object? value, String path) => _patternString(
      value,
      path,
      _digestPattern,
      maximumLength: 71,
    );

String _timestamp(Object? value, String path) => _patternString(
      value,
      path,
      _timestampPattern,
      maximumLength: 40,
    );

Uri _immutableHttpsUrl(Object? value, String path) {
  final source = _string(value, path);
  final uri = Uri.tryParse(source);
  if (source.length < 9 ||
      source.length > 2048 ||
      uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      source.contains('\\') ||
      source.runes.any((rune) => rune <= 0x20 || rune == 0x7f)) {
    throw MosaicConfigurationDeliveryException('Invalid URL at $path.');
  }
  return uri;
}

Set<String> _uniqueIdentifiers(
  Object? value,
  String path, {
  required int maximum,
}) {
  final entries = _list(value, path, maximum: maximum);
  final result = <String>{};
  for (var index = 0; index < entries.length; index += 1) {
    if (!result.add(_identifier(entries[index], '$path[$index]'))) {
      throw MosaicConfigurationDeliveryException(
        'Duplicate identifier at $path.',
      );
    }
  }
  return result;
}

bool _sameSet(Iterable<String> left, Iterable<String> right) {
  final leftSet = left.toSet();
  final rightSet = right.toSet();
  return leftSet.length == rightSet.length && leftSet.containsAll(rightSet);
}

final RegExp _identifierPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _placementKeyPattern = RegExp(r'^[a-z][a-z0-9_]*$');
final RegExp _environmentKeyPattern = RegExp(r'^[a-z][a-z0-9_-]*$');
final RegExp _digestPattern = RegExp(r'^sha256:[a-f0-9]{64}$');
final RegExp _timestampPattern = RegExp(
  r'^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?Z$',
);
final RegExp _mediaTypePattern =
    RegExp(r'^(image|video)/[a-z0-9][a-z0-9.+-]*$');
