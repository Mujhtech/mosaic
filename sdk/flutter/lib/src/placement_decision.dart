import 'dart:convert';

import 'locale_tag.dart';
import 'placement_identity.dart';
import 'sha256.dart';

const String mosaicPlacementDecisionVersion = '1';
const String mosaicRolloutAlgorithm = 'sha256_length_prefixed_v1';

const Set<String> mosaicDecisionFeatures = <String>{
  'condition.all',
  'condition.any',
  'condition.not',
  'operator.equals',
  'operator.not_equals',
  'operator.in',
  'operator.not_in',
  'operator.greater_than',
  'operator.greater_than_or_equal',
  'operator.less_than',
  'operator.less_than_or_equal',
  'operator.exists',
  'operator.does_not_exist',
  'operator.contains_any',
  'operator.contains_all',
  'operator.locale_matches',
  'outcome.paywall',
  'outcome.no_paywall',
  'outcome.fallback',
  'outcome.unavailable',
  'source.device.platform',
  'source.device.os_version',
  'source.application.version',
  'source.application.locale',
  'source.context.country',
  'source.environment.id',
  'source.environment.key',
  'source.identity.user_present',
  'source.user_attribute',
  'source.entitlement_state',
  'source.product_availability',
  'source.product_readiness',
  'source.provider_capability',
  'override.qa',
};

final class MosaicPlacementDecisionException implements Exception {
  const MosaicPlacementDecisionException(this.message);
  final String message;
  @override
  String toString() => 'MosaicPlacementDecisionException: $message';
}

enum MosaicAssignmentPolicy {
  installation,
  identifiedUser,
  identifiedUserOrInstallation,
}

enum MosaicAttributeType {
  string,
  boolean,
  number,
  timestamp,
  semanticVersion,
  stringList
}

enum MosaicAttributeSensitivity { standard, sensitive }

final class MosaicAttributeDefinition {
  MosaicAttributeDefinition({
    required this.key,
    required this.type,
    required this.sensitivity,
    required Iterable<String> allowedOperators,
  }) : allowedOperators = Set.unmodifiable(allowedOperators);
  final String key;
  final MosaicAttributeType type;
  final MosaicAttributeSensitivity sensitivity;
  final Set<String> allowedOperators;
}

sealed class MosaicDecisionOutcome {
  const MosaicDecisionOutcome();
}

final class MosaicPaywallDecisionOutcome extends MosaicDecisionOutcome {
  const MosaicPaywallDecisionOutcome(
      {required this.paywallVersionId, this.unavailableFallbackKey});
  final String paywallVersionId;
  final String? unavailableFallbackKey;
}

final class MosaicNoPaywallDecisionOutcome extends MosaicDecisionOutcome {
  const MosaicNoPaywallDecisionOutcome();
}

final class MosaicFallbackDecisionOutcome extends MosaicDecisionOutcome {
  const MosaicFallbackDecisionOutcome(this.key);
  final String key;
}

final class MosaicUnavailableDecisionOutcome extends MosaicDecisionOutcome {
  const MosaicUnavailableDecisionOutcome(this.reason);
  final String reason;
}

sealed class MosaicConditionNode {
  const MosaicConditionNode();
}

final class MosaicConditionLeaf extends MosaicConditionNode {
  const MosaicConditionLeaf({
    required this.sourceKind,
    required this.operator,
    this.sourceKey,
    this.operand,
  });
  final String sourceKind;
  final String? sourceKey;
  final String operator;
  final MosaicAttributeValue? operand;
}

final class MosaicConditionGroup extends MosaicConditionNode {
  MosaicConditionGroup(
      {required this.type, required Iterable<MosaicConditionNode> children})
      : children = List.unmodifiable(children);
  final String type;
  final List<MosaicConditionNode> children;
}

final class MosaicConditionNot extends MosaicConditionNode {
  const MosaicConditionNot(this.child);
  final MosaicConditionNode child;
}

final class MosaicDecisionRollout {
  const MosaicDecisionRollout(this.thresholdBasisPoints);
  final int thresholdBasisPoints;
}

final class MosaicPlacementRule {
  const MosaicPlacementRule({
    required this.id,
    required this.priority,
    required this.enabled,
    required this.conditions,
    required this.outcome,
    this.safeLabel,
    this.rollout,
  });
  final String id;
  final int priority;
  final bool enabled;
  final String? safeLabel;
  final MosaicConditionNode conditions;
  final MosaicDecisionRollout? rollout;
  final MosaicDecisionOutcome outcome;
}

final class MosaicDecisionFallback {
  const MosaicDecisionFallback(
      {required this.key, required this.outcome, this.safeLabel});
  final String key;
  final String? safeLabel;
  final MosaicDecisionOutcome outcome;
}

final class MosaicQaOverride {
  const MosaicQaOverride({
    required this.id,
    required this.selectorDigest,
    required this.safeLabel,
    required this.startsAt,
    required this.expiresAt,
    required this.outcome,
  });
  final String id;
  final String selectorDigest;
  final String safeLabel;
  final DateTime startsAt;
  final DateTime expiresAt;
  final MosaicDecisionOutcome outcome;
}

final class MosaicPlacementRuleSet {
  MosaicPlacementRuleSet({
    required this.id,
    required this.version,
    required this.projectId,
    required this.environmentId,
    required this.environmentKey,
    required this.placementId,
    required this.placementKey,
    required this.enabled,
    required this.assignmentPolicy,
    required Iterable<MosaicAttributeDefinition> attributeDefinitions,
    required Iterable<MosaicDecisionFallback> fallbacks,
    required Iterable<MosaicPlacementRule> rules,
    required this.defaultOutcome,
    required Iterable<MosaicQaOverride> qaOverrides,
    Iterable<String> requiredFeatures = const <String>{},
    Iterable<String> bucketingAlgorithms = const <String>{},
  })  : attributeDefinitions = Map.unmodifiable(
            {for (final item in attributeDefinitions) item.key: item}),
        fallbacks =
            Map.unmodifiable({for (final item in fallbacks) item.key: item}),
        rules = List.unmodifiable(
            rules.toList()..sort((a, b) => a.priority.compareTo(b.priority))),
        qaOverrides = List.unmodifiable(qaOverrides),
        requiredFeatures = Set.unmodifiable(requiredFeatures),
        bucketingAlgorithms = Set.unmodifiable(bucketingAlgorithms);
  final String id;
  final int version;
  final String projectId;
  final String environmentId;
  final String environmentKey;
  final String placementId;
  final String placementKey;
  final bool enabled;
  final MosaicAssignmentPolicy assignmentPolicy;
  final Map<String, MosaicAttributeDefinition> attributeDefinitions;
  final Map<String, MosaicDecisionFallback> fallbacks;
  final List<MosaicPlacementRule> rules;
  final MosaicDecisionOutcome defaultOutcome;
  final List<MosaicQaOverride> qaOverrides;
  final Set<String> requiredFeatures;
  final Set<String> bucketingAlgorithms;
}

enum MosaicTruthValue { yes, no, unknown }

enum MosaicEntitlementDecisionState {
  active,
  inactive,
  unknown,
  providerUnavailable,
  failed
}

enum MosaicProductDecisionState {
  available,
  unavailable,
  unknown,
  providerUnavailable,
  failed,
}

enum MosaicProductReadiness { ready, notReady }

enum MosaicProviderCapabilityState { available, unavailable, unknown }

final class MosaicDecisionContext {
  MosaicDecisionContext({
    this.platform,
    this.osVersion,
    this.applicationVersion,
    this.applicationLocale,
    this.country,
    this.userPresent = false,
    Map<String, MosaicAttributeValue> attributes = const {},
    Map<String, MosaicEntitlementDecisionState> entitlements = const {},
    Map<String, MosaicProductDecisionState> products = const {},
    Map<String, MosaicProductReadiness> productReadiness = const {},
    Map<String, MosaicProviderCapabilityState> providerCapabilities = const {},
    Set<String> qaOverrideTokens = const {},
    DateTime? now,
  })  : attributes = Map.unmodifiable(attributes),
        entitlements = Map.unmodifiable(entitlements),
        products = Map.unmodifiable(products),
        productReadiness = Map.unmodifiable(productReadiness),
        providerCapabilities = Map.unmodifiable(providerCapabilities),
        qaOverrideTokens = Set.unmodifiable(qaOverrideTokens),
        now = (now ?? DateTime.now()).toUtc();
  final String? platform;
  final String? osVersion;
  final String? applicationVersion;
  final String? applicationLocale;
  final String? country;
  final bool userPresent;
  final Map<String, MosaicAttributeValue> attributes;
  final Map<String, MosaicEntitlementDecisionState> entitlements;
  final Map<String, MosaicProductDecisionState> products;
  final Map<String, MosaicProductReadiness> productReadiness;
  final Map<String, MosaicProviderCapabilityState> providerCapabilities;
  final Set<String> qaOverrideTokens;
  final DateTime now;
}

final class MosaicAssignmentKey {
  const MosaicAssignmentKey({required this.type, required this.value});
  final String type;
  final String value;
}

final class MosaicDecisionTraceStep {
  const MosaicDecisionTraceStep(
      {required this.code, required this.message, this.ruleId, this.truth});
  final String code;
  final String message;
  final String? ruleId;
  final MosaicTruthValue? truth;
}

sealed class MosaicPlacementDecisionResult {
  MosaicPlacementDecisionResult({
    required Iterable<MosaicDecisionTraceStep> trace,
    this.matchedRuleId,
    this.rolloutBucket,
    this.assignmentKeyType,
    Iterable<String> fallbackPath = const [],
  })  : trace = List.unmodifiable(trace),
        fallbackPath = List.unmodifiable(fallbackPath);
  final List<MosaicDecisionTraceStep> trace;
  final String? matchedRuleId;
  final int? rolloutBucket;
  final String? assignmentKeyType;
  final List<String> fallbackPath;
}

final class MosaicPaywallSelected extends MosaicPlacementDecisionResult {
  MosaicPaywallSelected(
      {required this.paywallVersionId,
      required super.trace,
      super.matchedRuleId,
      super.rolloutBucket,
      super.assignmentKeyType,
      super.fallbackPath});
  final String paywallVersionId;
  bool get usedFallback => fallbackPath.isNotEmpty;
}

final class MosaicNoPaywallSelected extends MosaicPlacementDecisionResult {
  MosaicNoPaywallSelected(
      {required super.trace,
      super.matchedRuleId,
      super.rolloutBucket,
      super.assignmentKeyType,
      super.fallbackPath});
}

final class MosaicDecisionUnavailable extends MosaicPlacementDecisionResult {
  MosaicDecisionUnavailable(
      {required this.reason,
      required super.trace,
      super.matchedRuleId,
      super.rolloutBucket,
      super.assignmentKeyType,
      super.fallbackPath});
  final String reason;
}

final class MosaicPlacementDecisionEvaluator {
  const MosaicPlacementDecisionEvaluator();

  MosaicPlacementDecisionResult evaluate({
    required MosaicPlacementRuleSet ruleSet,
    required MosaicDecisionContext context,
    required MosaicAssignmentKey? assignment,
  }) {
    final trace = <MosaicDecisionTraceStep>[];
    if (!ruleSet.enabled) {
      return MosaicDecisionUnavailable(
          reason: 'rule_set_disabled', trace: trace);
    }
    final override = _override(ruleSet, context);
    if (override != null) {
      trace.add(MosaicDecisionTraceStep(
          code: 'override.matched', message: 'A QA override matched.'));
      return _resolve(override.outcome, ruleSet, trace, null, null,
          assignment?.type, <String>[]);
    }
    String? matchedRuleId;
    int? bucket;
    for (final rule in ruleSet.rules) {
      if (!rule.enabled) continue;
      final truth = _condition(rule.conditions, ruleSet, context);
      trace.add(MosaicDecisionTraceStep(
        code: 'rule.evaluated',
        message: 'Rule evaluated to ${truth.name}.',
        ruleId: rule.id,
        truth: truth,
      ));
      if (truth != MosaicTruthValue.yes) continue;
      if (rule.rollout != null) {
        if (assignment == null) {
          trace.add(MosaicDecisionTraceStep(
              code: 'rollout.unknown',
              message: 'The assignment key is unavailable.',
              ruleId: rule.id));
          continue;
        }
        bucket = mosaicRolloutBucket(
          projectId: ruleSet.projectId,
          environmentId: ruleSet.environmentId,
          placementId: ruleSet.placementId,
          ruleId: rule.id,
          assignmentKeyType: assignment.type,
          assignmentKeyValue: assignment.value,
        );
        trace.add(MosaicDecisionTraceStep(
            code: 'rollout.evaluated',
            message: 'Rollout bucket $bucket was evaluated.',
            ruleId: rule.id));
        if (bucket >= rule.rollout!.thresholdBasisPoints) continue;
      }
      matchedRuleId = rule.id;
      return _resolve(rule.outcome, ruleSet, trace, matchedRuleId, bucket,
          assignment?.type, <String>[]);
    }
    trace.add(const MosaicDecisionTraceStep(
        code: 'default.selected',
        message: 'No Rule matched; the exact default was selected.'));
    return _resolve(ruleSet.defaultOutcome, ruleSet, trace, matchedRuleId,
        bucket, assignment?.type, <String>[]);
  }

  MosaicPlacementDecisionResult followFallback({
    required MosaicPlacementRuleSet ruleSet,
    required String fallbackKey,
    required MosaicPlacementDecisionResult previous,
    required String trigger,
  }) {
    final trace = <MosaicDecisionTraceStep>[
      ...previous.trace,
      MosaicDecisionTraceStep(
        code: 'fallback.triggered',
        message: 'Fallback was triggered by $trigger.',
      ),
    ];
    return _resolve(
      MosaicFallbackDecisionOutcome(fallbackKey),
      ruleSet,
      trace,
      previous.matchedRuleId,
      previous.rolloutBucket,
      previous.assignmentKeyType,
      previous.fallbackPath,
    );
  }

  MosaicQaOverride? _override(
      MosaicPlacementRuleSet ruleSet, MosaicDecisionContext context) {
    for (final override in ruleSet.qaOverrides) {
      if (context.now.isBefore(override.startsAt) ||
          !context.now.isBefore(override.expiresAt)) continue;
      for (final token in context.qaOverrideTokens) {
        if ('sha256:${mosaicSha256String(token)}' == override.selectorDigest)
          return override;
      }
    }
    return null;
  }

  MosaicPlacementDecisionResult _resolve(
    MosaicDecisionOutcome outcome,
    MosaicPlacementRuleSet ruleSet,
    List<MosaicDecisionTraceStep> trace,
    String? matchedRuleId,
    int? bucket,
    String? assignmentType,
    List<String> fallbackPath,
  ) {
    var current = outcome;
    final path = <String>[...fallbackPath];
    while (current is MosaicFallbackDecisionOutcome) {
      if (path.length >= 8 || path.contains(current.key)) {
        return MosaicDecisionUnavailable(
            reason: 'fallback_invalid',
            trace: trace,
            matchedRuleId: matchedRuleId,
            rolloutBucket: bucket,
            assignmentKeyType: assignmentType,
            fallbackPath: path);
      }
      path.add(current.key);
      trace.add(MosaicDecisionTraceStep(
          code: 'fallback.selected',
          message: 'Fallback ${current.key} was selected.'));
      final fallback = ruleSet.fallbacks[current.key];
      if (fallback == null) {
        return MosaicDecisionUnavailable(
            reason: 'fallback_missing',
            trace: trace,
            matchedRuleId: matchedRuleId,
            rolloutBucket: bucket,
            assignmentKeyType: assignmentType,
            fallbackPath: path);
      }
      current = fallback.outcome;
    }
    if (current is MosaicPaywallDecisionOutcome) {
      return MosaicPaywallSelected(
          paywallVersionId: current.paywallVersionId,
          trace: trace,
          matchedRuleId: matchedRuleId,
          rolloutBucket: bucket,
          assignmentKeyType: assignmentType,
          fallbackPath: path);
    }
    if (current is MosaicNoPaywallDecisionOutcome) {
      return MosaicNoPaywallSelected(
          trace: trace,
          matchedRuleId: matchedRuleId,
          rolloutBucket: bucket,
          assignmentKeyType: assignmentType,
          fallbackPath: path);
    }
    return MosaicDecisionUnavailable(
      reason: current is MosaicUnavailableDecisionOutcome
          ? current.reason
          : 'evaluation_failed',
      trace: trace,
      matchedRuleId: matchedRuleId,
      rolloutBucket: bucket,
      assignmentKeyType: assignmentType,
      fallbackPath: path,
    );
  }

  MosaicTruthValue _condition(MosaicConditionNode node,
      MosaicPlacementRuleSet ruleSet, MosaicDecisionContext context) {
    if (node is MosaicConditionNot) {
      return switch (_condition(node.child, ruleSet, context)) {
        MosaicTruthValue.yes => MosaicTruthValue.no,
        MosaicTruthValue.no => MosaicTruthValue.yes,
        MosaicTruthValue.unknown => MosaicTruthValue.unknown,
      };
    }
    if (node is MosaicConditionGroup) {
      final values =
          node.children.map((child) => _condition(child, ruleSet, context));
      if (node.type == 'all') {
        if (values.contains(MosaicTruthValue.no)) return MosaicTruthValue.no;
        return values.contains(MosaicTruthValue.unknown)
            ? MosaicTruthValue.unknown
            : MosaicTruthValue.yes;
      }
      if (values.contains(MosaicTruthValue.yes)) return MosaicTruthValue.yes;
      return values.contains(MosaicTruthValue.unknown)
          ? MosaicTruthValue.unknown
          : MosaicTruthValue.no;
    }
    final leaf = node as MosaicConditionLeaf;
    final source = _resolveSource(leaf, ruleSet, context);
    // Presence reports what the host supplied, never whether Mosaic can use
    // it. Collapsing the two would let `does_not_exist` claim a device
    // reported no locale, country, or platform when it reported an unusable
    // one.
    if (leaf.operator == 'exists') {
      return source.present ? MosaicTruthValue.yes : MosaicTruthValue.no;
    }
    if (leaf.operator == 'does_not_exist') {
      return source.present ? MosaicTruthValue.no : MosaicTruthValue.yes;
    }
    // Absent and present-but-unusable both compare unknown. Answering "no"
    // here is the whole hazard: a `not` around it becomes a positive match.
    final actual = source.comparable;
    final listComparison = leaf.operator == 'in' || leaf.operator == 'not_in';
    if (actual == null ||
        leaf.operand == null ||
        (listComparison
            ? leaf.operand!.type != 'string_list'
            : actual.type != leaf.operand!.type)) {
      return MosaicTruthValue.unknown;
    }
    // Locale comparison is symmetric: the authored operand is read in the same
    // canonical form as the runtime value, so `equals` and `in` cannot depend
    // on which spelling of one locale each side happens to carry. An operand
    // with no canonical form makes the condition unknown.
    final operand = leaf.sourceKind == 'application.locale'
        ? _canonicalLocaleOperand(leaf.operand!)
        : leaf.operand!;
    if (operand == null) return MosaicTruthValue.unknown;
    final compared = _compare(actual, operand, leaf.operator);
    return compared == null
        ? MosaicTruthValue.unknown
        : (compared ? MosaicTruthValue.yes : MosaicTruthValue.no);
  }

  /// Resolves one source into what the host supplied and what, if anything,
  /// can be compared against it.
  ///
  /// The three host-supplied sources with a validity rule — locale, country,
  /// and the closed platform vocabulary — report present with no comparable
  /// form when the host named something Mosaic cannot use. A malformed
  /// semantic version is the same shape, expressed one layer down: it is
  /// present and every ordering against it is unknown.
  _SourceResolution _resolveSource(MosaicConditionLeaf leaf,
      MosaicPlacementRuleSet ruleSet, MosaicDecisionContext context) {
    final key = leaf.sourceKey;
    return switch (leaf.sourceKind) {
      'device.platform' => _reported(
          context.platform,
          (value) => const {'ios', 'android'}.contains(value)
              ? MosaicStringAttribute(value)
              : null,
        ),
      'device.os_version' =>
        _reported(context.osVersion, MosaicSemanticVersionAttribute.new),
      'application.version' => _reported(
          context.applicationVersion, MosaicSemanticVersionAttribute.new),
      // The host's identifier is canonicalized before it is read, so a POSIX
      // or ICU-keyword shape targets the locale it names. One it cannot
      // canonicalize is reported, not usable.
      'application.locale' => _reported(
          context.applicationLocale,
          (value) => switch (mosaicNormalizeLocaleTag(value)) {
            final String tag => MosaicStringAttribute(tag),
            _ => null,
          },
        ),
      'context.country' => _reported(
          context.country,
          (value) => RegExp(r'^[A-Za-z]{2}$').hasMatch(value)
              ? MosaicStringAttribute(value.toUpperCase())
              : null,
        ),
      'environment.id' => _usable(MosaicStringAttribute(ruleSet.environmentId)),
      'environment.key' =>
        _usable(MosaicStringAttribute(ruleSet.environmentKey)),
      'identity.user_present' =>
        _usable(MosaicBooleanAttribute(context.userPresent)),
      'user_attribute' => _optional(context.attributes[key]),
      'entitlement_state' => _optional(
          context.entitlements[key] == null
              ? null
              : MosaicStringAttribute(
                  _wireEntitlement(context.entitlements[key]!)),
        ),
      'product_availability' => _optional(
          context.products[key] == null
              ? null
              : MosaicStringAttribute(_wireProduct(context.products[key]!)),
        ),
      'product_readiness' => _optional(
          context.productReadiness[key] == null
              ? null
              : MosaicStringAttribute(
                  context.productReadiness[key] == MosaicProductReadiness.ready
                      ? 'ready'
                      : 'not_ready'),
        ),
      'provider_capability' => _optional(
          context.providerCapabilities[key] == null
              ? null
              : MosaicStringAttribute(context.providerCapabilities[key]!.name),
        ),
      _ => _absentSource,
    };
  }
}

/// What one source resolved to: whether the host reported anything, and the
/// comparable form when Mosaic can use what it reported.
typedef _SourceResolution = ({MosaicAttributeValue? comparable, bool present});

const _SourceResolution _absentSource = (comparable: null, present: false);

_SourceResolution _usable(MosaicAttributeValue value) =>
    (comparable: value, present: true);

_SourceResolution _optional(MosaicAttributeValue? value) =>
    value == null ? _absentSource : _usable(value);

/// A host-reported value is always present. It is comparable only when
/// [comparable] can make sense of it.
_SourceResolution _reported(
  String? reported,
  MosaicAttributeValue? Function(String value) comparable,
) =>
    reported == null
        ? _absentSource
        : (comparable: comparable(reported), present: true);

bool? _compare(MosaicAttributeValue actual, MosaicAttributeValue operand,
    String operator) {
  final a = actual.value;
  final b = operand.value;
  if (actual.type == 'semantic_version' && a is String && b is String) {
    final ordering = _compareSemver(a, b);
    if (ordering == null) return null;
    if (operator == 'equals') return ordering == 0;
    if (operator == 'not_equals') return ordering != 0;
  }
  if (operator == 'equals') return _equal(a, b);
  if (operator == 'not_equals') return !_equal(a, b);
  if (operator == 'locale_matches' && a is String && b is String) {
    final normalizedA = mosaicNormalizeLocaleTag(a);
    final normalizedB = mosaicNormalizeLocaleTag(b);
    // An authored range with no canonical form is unknown, never false. False
    // would be a claim that the device is outside the range, which a negated
    // condition would then read as a match.
    if (normalizedA == null || normalizedB == null) return null;
    return normalizedA == normalizedB ||
        normalizedA.startsWith('$normalizedB-');
  }
  if ((operator == 'in' || operator == 'not_in') && b is List) {
    final contains = b.any((item) => _equal(a, item));
    return operator == 'in' ? contains : !contains;
  }
  if ((operator == 'contains_any' || operator == 'contains_all') &&
      a is List &&
      b is List) {
    return operator == 'contains_any' ? b.any(a.contains) : b.every(a.contains);
  }
  int? ordering;
  if (a is num && b is num) ordering = a.compareTo(b);
  if (actual.type == 'timestamp' && a is DateTime && b is DateTime)
    ordering = a.compareTo(b);
  if (actual.type == 'semantic_version' && a is String && b is String)
    ordering = _compareSemver(a, b);
  if (ordering == null) return null;
  return switch (operator) {
    'greater_than' => ordering > 0,
    'greater_than_or_equal' => ordering >= 0,
    'less_than' => ordering < 0,
    'less_than_or_equal' => ordering <= 0,
    _ => null,
  };
}

bool _equal(Object? a, Object? b) => a is List && b is List
    ? a.length == b.length &&
        List.generate(a.length, (i) => a[i] == b[i]).every((v) => v)
    : a == b;

String _wireEntitlement(MosaicEntitlementDecisionState value) =>
    switch (value) {
      MosaicEntitlementDecisionState.active => 'active',
      MosaicEntitlementDecisionState.inactive => 'inactive',
      MosaicEntitlementDecisionState.unknown => 'unknown',
      MosaicEntitlementDecisionState.providerUnavailable =>
        'provider_unavailable',
      MosaicEntitlementDecisionState.failed => 'failed',
    };

String _wireProduct(MosaicProductDecisionState value) => switch (value) {
      MosaicProductDecisionState.available => 'available',
      MosaicProductDecisionState.unavailable => 'unavailable',
      MosaicProductDecisionState.unknown => 'unknown',
      MosaicProductDecisionState.providerUnavailable => 'provider_unavailable',
      MosaicProductDecisionState.failed => 'failed',
    };

bool _validLocale(String value) =>
    RegExp(r'^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$')
        .hasMatch(value.replaceAll('_', '-'));

/// The authored side of a locale comparison, in the same canonical form the
/// runtime value is read in, or `null` when the author wrote something with no
/// canonical form.
///
/// One unusable member makes the whole list `null`, even when another member
/// would have matched. The list is a single defective authored value, and
/// evaluating the half that parsed would decide a Rule on half of what its
/// author wrote — and would do it at that Rule's priority, selecting a
/// different Rule rather than merely a different truth value.
MosaicAttributeValue? _canonicalLocaleOperand(MosaicAttributeValue operand) {
  switch (operand) {
    case MosaicStringAttribute(:final value):
      final tag = mosaicNormalizeLocaleTag(value);
      return tag == null ? null : MosaicStringAttribute(tag);
    case MosaicStringListAttribute(:final value):
      final canonical = <String>[];
      for (final member in value) {
        final tag = mosaicNormalizeLocaleTag(member);
        if (tag == null) return null;
        canonical.add(tag);
      }
      return MosaicStringListAttribute(canonical);
    default:
      return operand;
  }
}

int? _compareSemver(String left, String right) {
  final a = _semver(left);
  final b = _semver(right);
  if (a == null || b == null) return null;
  for (var i = 0; i < 3; i++) {
    final compared = a.$1[i].compareTo(b.$1[i]);
    if (compared != 0) return compared;
  }
  final ap = a.$2;
  final bp = b.$2;
  if (ap == null && bp == null) return 0;
  if (ap == null) return 1;
  if (bp == null) return -1;
  final length = ap.length > bp.length ? ap.length : bp.length;
  for (var i = 0; i < length; i++) {
    if (i >= ap.length) return -1;
    if (i >= bp.length) return 1;
    final ai = int.tryParse(ap[i]);
    final bi = int.tryParse(bp[i]);
    final compared = ai != null && bi != null
        ? ai.compareTo(bi)
        : ai != null
            ? -1
            : bi != null
                ? 1
                : ap[i].compareTo(bp[i]);
    if (compared != 0) return compared;
  }
  return 0;
}

(List<int>, List<String>?)? _semver(String value) {
  final match = RegExp(
          r'^(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?(?:\.(0|[1-9][0-9]*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$')
      .firstMatch(value);
  if (match == null) return null;
  final prerelease = match[4]?.split('.');
  if (prerelease?.any((part) =>
          RegExp(r'^[0-9]+$').hasMatch(part) &&
          part.length > 1 &&
          part.startsWith('0')) ??
      false) return null;
  return (
    <int>[
      int.parse(match[1]!),
      int.parse(match[2] ?? '0'),
      int.parse(match[3] ?? '0')
    ],
    prerelease
  );
}

int mosaicRolloutBucket(
    {required String projectId,
    required String environmentId,
    required String placementId,
    required String ruleId,
    required String assignmentKeyType,
    required String assignmentKeyValue}) {
  String field(String value) => '${utf8.encode(value).length}:$value\n';
  final canonical =
      'mosaic-placement-rollout\n1\n${field(projectId)}${field(environmentId)}${field(placementId)}${field(ruleId)}${field(assignmentKeyType)}${field(assignmentKeyValue)}';
  final digest = mosaicSha256String(canonical);
  var bucket = 0;
  for (var offset = 0; offset < 16; offset += 2) {
    bucket = (bucket * 256 +
            int.parse(digest.substring(offset, offset + 2), radix: 16)) %
        10000;
  }
  return bucket;
}

final class MosaicPlacementDecisionDecoder {
  const MosaicPlacementDecisionDecoder();

  MosaicPlacementRuleSet decode(Object? value) {
    if (utf8.encode(jsonEncode(value)).length > 256 * 1024) {
      throw const MosaicPlacementDecisionException(
          'Decision document exceeds its byte limit.');
    }
    final envelope = _map(value);
    _keys(envelope, const {'placementDecisionVersion', 'ruleSet'});
    if (envelope['placementDecisionVersion'] != '1')
      throw const MosaicPlacementDecisionException(
          'Unsupported decision version.');
    final object = _map(envelope['ruleSet']);
    _keys(object, const {
      'id',
      'version',
      'projectId',
      'environmentId',
      'environmentKey',
      'placementId',
      'placementKey',
      'enabled',
      'assignmentPolicy',
      'attributeDefinitions',
      'fallbacks',
      'rules',
      'defaultOutcome',
      'qaOverrides',
      'compatibility'
    });
    final definitions =
        _list(object['attributeDefinitions'], 32).map(_definition).toList();
    _unique(definitions.map((e) => e.key));
    final fallbacks = _list(object['fallbacks'], 32).map(_fallback).toList();
    _unique(fallbacks.map((e) => e.key));
    final rules = _list(object['rules'], 100).map(_rule).toList();
    _unique(rules.map((e) => e.id));
    _unique(rules.map((e) => e.priority.toString()));
    final overrides = _list(object['qaOverrides'], 32).map(_override).toList();
    _unique(overrides.map((e) => e.id));
    _unique(overrides.map((e) => e.selectorDigest));
    final compatibility = _map(object['compatibility']);
    _keys(compatibility, const {'requiredFeatures', 'bucketingAlgorithms'});
    final features = _strings(compatibility['requiredFeatures'], 64);
    if (!mosaicDecisionFeatures.containsAll(features))
      throw const MosaicPlacementDecisionException(
          'Unsupported decision feature.');
    final algorithms = _strings(compatibility['bucketingAlgorithms'], 1);
    if (algorithms.any((value) => value != mosaicRolloutAlgorithm))
      throw const MosaicPlacementDecisionException(
          'Unsupported rollout algorithm.');
    final result = MosaicPlacementRuleSet(
      id: _id(object['id']),
      version: _int(object['version'], 1, 1 << 52),
      projectId: _id(object['projectId']),
      environmentId: _id(object['environmentId']),
      environmentKey: _environmentKey(object['environmentKey']),
      placementId: _id(object['placementId']),
      placementKey: _key(object['placementKey']),
      enabled: _bool(object['enabled']),
      assignmentPolicy: switch (object['assignmentPolicy']) {
        'installation' => MosaicAssignmentPolicy.installation,
        'identified_user' => MosaicAssignmentPolicy.identifiedUser,
        'identified_user_or_installation' =>
          MosaicAssignmentPolicy.identifiedUserOrInstallation,
        _ => throw const MosaicPlacementDecisionException(
            'Invalid assignment policy.'),
      },
      attributeDefinitions: definitions,
      fallbacks: fallbacks,
      rules: rules,
      defaultOutcome: _outcome(object['defaultOutcome']),
      qaOverrides: overrides,
      requiredFeatures: features,
      bucketingAlgorithms: algorithms,
    );
    _validate(result, features, algorithms);
    return result;
  }

  MosaicAttributeDefinition _definition(Object? value) {
    final o = _map(value);
    _keys(o, const {'key', 'type', 'sensitivity', 'allowedOperators'});
    return MosaicAttributeDefinition(
        key: _key(o['key']),
        type: switch (o['type']) {
          'string' => MosaicAttributeType.string,
          'boolean' => MosaicAttributeType.boolean,
          'number' => MosaicAttributeType.number,
          'timestamp' => MosaicAttributeType.timestamp,
          'semantic_version' => MosaicAttributeType.semanticVersion,
          'string_list' => MosaicAttributeType.stringList,
          _ => throw const MosaicPlacementDecisionException(
              'Invalid attribute type.'),
        },
        sensitivity: o['sensitivity'] == 'standard'
            ? MosaicAttributeSensitivity.standard
            : o['sensitivity'] == 'sensitive'
                ? MosaicAttributeSensitivity.sensitive
                : throw const MosaicPlacementDecisionException(
                    'Invalid sensitivity.'),
        allowedOperators: _strings(o['allowedOperators'], 13, minimum: 1));
  }

  MosaicDecisionFallback _fallback(Object? value) {
    final o = _map(value);
    _keys(o, const {'key', 'safeLabel', 'outcome'},
        optional: const {'safeLabel'});
    return MosaicDecisionFallback(
        key: _key(o['key']),
        safeLabel: o['safeLabel'] as String?,
        outcome: _outcome(o['outcome']));
  }

  MosaicQaOverride _override(Object? value) {
    final o = _map(value);
    _keys(o, const {
      'id',
      'selectorDigest',
      'safeLabel',
      'startsAt',
      'expiresAt',
      'outcome'
    });
    final digest = o['selectorDigest'];
    if (digest is! String || !RegExp(r'^sha256:[a-f0-9]{64}$').hasMatch(digest))
      throw const MosaicPlacementDecisionException('Invalid override digest.');
    return MosaicQaOverride(
        id: _id(o['id']),
        selectorDigest: digest,
        safeLabel: _string(o['safeLabel']),
        startsAt: _time(o['startsAt']),
        expiresAt: _time(o['expiresAt']),
        outcome: _outcome(o['outcome']));
  }

  MosaicPlacementRule _rule(Object? value) {
    final o = _map(value);
    _keys(o, const {
      'id',
      'priority',
      'enabled',
      'safeLabel',
      'conditions',
      'rollout',
      'outcome'
    }, optional: const {
      'safeLabel',
      'rollout'
    });
    final rollout = o['rollout'] == null ? null : _rollout(o['rollout']);
    return MosaicPlacementRule(
        id: _id(o['id']),
        priority: _int(o['priority'], 0, 9999),
        enabled: _bool(o['enabled']),
        safeLabel: o['safeLabel'] as String?,
        conditions: _node(o['conditions'], 1),
        rollout: rollout,
        outcome: _outcome(o['outcome']));
  }

  MosaicDecisionRollout _rollout(Object? value) {
    final o = _map(value);
    _keys(o, const {'algorithm', 'thresholdBasisPoints'});
    if (o['algorithm'] != mosaicRolloutAlgorithm)
      throw const MosaicPlacementDecisionException(
          'Unsupported rollout algorithm.');
    return MosaicDecisionRollout(_int(o['thresholdBasisPoints'], 0, 10000));
  }

  MosaicConditionNode _node(Object? value, int depth) {
    if (depth > 5)
      throw const MosaicPlacementDecisionException(
          'Condition depth exceeds limit.');
    final o = _map(value);
    final type = o['type'];
    if (type == 'condition') {
      _keys(o, const {'type', 'source', 'operator', 'operand'},
          optional: const {'operand'});
      final source = _map(o['source']);
      final kind = _string(source['kind']);
      String? key;
      if (kind == 'user_attribute' || kind == 'entitlement_state') {
        _keys(source, const {'kind', 'key'});
        key = _key(source['key']);
      } else if (kind == 'product_availability' ||
          kind == 'product_readiness') {
        _keys(source, const {'kind', 'productId'});
        key = _id(source['productId']);
      } else if (kind == 'provider_capability') {
        _keys(source, const {'kind', 'capability'});
        key = _string(source['capability']);
        if (!const {
          'product_loading',
          'purchase',
          'restore',
          'entitlement_lookup',
        }.contains(key)) {
          throw const MosaicPlacementDecisionException(
              'Unsupported provider capability.');
        }
      } else {
        _keys(source, const {'kind'});
      }
      const sources = {
        'device.platform',
        'device.os_version',
        'application.version',
        'application.locale',
        'context.country',
        'environment.id',
        'environment.key',
        'identity.user_present',
        'user_attribute',
        'entitlement_state',
        'product_availability',
        'product_readiness',
        'provider_capability'
      };
      if (!sources.contains(kind))
        throw const MosaicPlacementDecisionException('Unsupported source.');
      final operator = _string(o['operator']);
      const operators = {
        'equals',
        'not_equals',
        'in',
        'not_in',
        'greater_than',
        'greater_than_or_equal',
        'less_than',
        'less_than_or_equal',
        'exists',
        'does_not_exist',
        'contains_any',
        'contains_all',
        'locale_matches'
      };
      if (!operators.contains(operator))
        throw const MosaicPlacementDecisionException('Unsupported operator.');
      final noOperand = operator == 'exists' || operator == 'does_not_exist';
      if (noOperand != !o.containsKey('operand'))
        throw const MosaicPlacementDecisionException(
            'Invalid condition operand.');
      return MosaicConditionLeaf(
          sourceKind: kind,
          sourceKey: key,
          operator: operator,
          operand: noOperand ? null : _typed(o['operand']));
    }
    if (type == 'all' || type == 'any') {
      _keys(o, const {'type', 'children'});
      final children =
          _list(o['children'], 16, minimum: 2).map((v) => _node(v, depth + 1));
      return MosaicConditionGroup(type: type as String, children: children);
    }
    if (type == 'not') {
      _keys(o, const {'type', 'child'});
      return MosaicConditionNot(_node(o['child'], depth + 1));
    }
    throw const MosaicPlacementDecisionException('Invalid condition node.');
  }

  MosaicAttributeValue _typed(Object? value) {
    final o = _map(value);
    _keys(o, const {'type', 'value'});
    final raw = o['value'];
    return switch (o['type']) {
      'string' when raw is String && raw.length <= 256 =>
        MosaicStringAttribute(raw),
      'boolean' when raw is bool => MosaicBooleanAttribute(raw),
      'number' when raw is num && raw.isFinite => MosaicNumberAttribute(raw),
      'timestamp' when raw is String => MosaicTimestampAttribute(_time(raw)),
      'semantic_version'
          when raw is String && raw.isNotEmpty && raw.length <= 128 =>
        MosaicSemanticVersionAttribute(raw),
      'string_list' when raw is List && raw.every((v) => v is String) =>
        MosaicStringListAttribute(raw.cast<String>()),
      _ => throw const MosaicPlacementDecisionException('Invalid typed value.'),
    };
  }

  MosaicDecisionOutcome _outcome(Object? value) {
    final o = _map(value);
    return switch (o['type']) {
      'paywall' => () {
          _keys(o, const {'type', 'paywallVersionId', 'unavailableFallbackKey'},
              optional: const {'unavailableFallbackKey'});
          return MosaicPaywallDecisionOutcome(
              paywallVersionId: _id(o['paywallVersionId']),
              unavailableFallbackKey: o['unavailableFallbackKey'] == null
                  ? null
                  : _key(o['unavailableFallbackKey']));
        }(),
      'no_paywall' => () {
          _keys(o, const {'type'});
          return const MosaicNoPaywallDecisionOutcome();
        }(),
      'fallback' => () {
          _keys(o, const {'type', 'key'});
          return MosaicFallbackDecisionOutcome(_key(o['key']));
        }(),
      'unavailable' => () {
          _keys(o, const {'type', 'reason'});
          final reason = _string(o['reason']);
          if (!{
            'no_safe_decision',
            'configuration_incompatible',
            'content_unavailable',
            'commerce_unavailable'
          }.contains(reason))
            throw const MosaicPlacementDecisionException(
                'Invalid unavailable reason.');
          return MosaicUnavailableDecisionOutcome(reason);
        }(),
      _ => throw const MosaicPlacementDecisionException('Invalid outcome.'),
    };
  }

  void _validate(MosaicPlacementRuleSet set, Set<String> declaredFeatures,
      Set<String> declaredAlgorithms) {
    for (final definition in set.attributeDefinitions.values) {
      if (!_attributeOperators(definition.type)
          .containsAll(definition.allowedOperators)) {
        throw const MosaicPlacementDecisionException(
            'Attribute declares an incompatible operator.');
      }
    }
    final leaves = <MosaicConditionLeaf>[];
    void walk(MosaicConditionNode node) {
      if (node is MosaicConditionLeaf)
        leaves.add(node);
      else if (node is MosaicConditionNot)
        walk(node.child);
      else
        for (final child in (node as MosaicConditionGroup).children) {
          walk(child);
        }
    }

    for (final rule in set.rules) {
      leaves.clear();
      walk(rule.conditions);
      if (leaves.length > 64)
        throw const MosaicPlacementDecisionException(
            'Rule exceeds leaf limit.');
      for (final leaf in leaves) {
        _validateLeaf(leaf, set.attributeDefinitions);
      }
    }
    void checkOutcome(MosaicDecisionOutcome outcome) {
      if (outcome is MosaicFallbackDecisionOutcome &&
          !set.fallbacks.containsKey(outcome.key))
        throw const MosaicPlacementDecisionException('Missing fallback.');
      if (outcome is MosaicPaywallDecisionOutcome &&
          outcome.unavailableFallbackKey != null &&
          !set.fallbacks.containsKey(outcome.unavailableFallbackKey))
        throw const MosaicPlacementDecisionException('Missing fallback.');
    }

    for (final rule in set.rules) checkOutcome(rule.outcome);
    checkOutcome(set.defaultOutcome);
    for (final fallback in set.fallbacks.values) checkOutcome(fallback.outcome);
    for (final key in set.fallbacks.keys) {
      final seen = <String>{};
      String? currentKey = key;
      var depth = 0;
      while (currentKey != null) {
        if (!seen.add(currentKey)) {
          throw const MosaicPlacementDecisionException('Fallback cycle.');
        }
        depth += 1;
        if (depth > 8) {
          throw const MosaicPlacementDecisionException(
              'Fallback depth exceeds limit.');
        }
        final outcome = set.fallbacks[currentKey]!.outcome;
        currentKey = switch (outcome) {
          MosaicFallbackDecisionOutcome() => outcome.key,
          MosaicPaywallDecisionOutcome() => outcome.unavailableFallbackKey,
          _ => null,
        };
      }
    }
    for (final override in set.qaOverrides) {
      final duration = override.expiresAt.difference(override.startsAt);
      if (duration <= Duration.zero || duration > const Duration(hours: 24)) {
        throw const MosaicPlacementDecisionException(
            'QA override duration is invalid.');
      }
    }
    final referenced = _referencedFeatures(set);
    if (referenced.length != declaredFeatures.length ||
        !referenced.containsAll(declaredFeatures)) {
      throw const MosaicPlacementDecisionException(
          'Decision features are not declared exactly.');
    }
    final expectedAlgorithms = set.rules.any((rule) => rule.rollout != null)
        ? const <String>{mosaicRolloutAlgorithm}
        : const <String>{};
    if (expectedAlgorithms.length != declaredAlgorithms.length ||
        !expectedAlgorithms.containsAll(declaredAlgorithms)) {
      throw const MosaicPlacementDecisionException(
          'Decision algorithms are not declared exactly.');
    }
  }
}

Set<String> _attributeOperators(MosaicAttributeType type) => switch (type) {
      MosaicAttributeType.string => const {
          'equals',
          'not_equals',
          'in',
          'not_in',
          'exists',
          'does_not_exist'
        },
      MosaicAttributeType.boolean => const {
          'equals',
          'not_equals',
          'exists',
          'does_not_exist'
        },
      MosaicAttributeType.number ||
      MosaicAttributeType.timestamp ||
      MosaicAttributeType.semanticVersion =>
        const {
          'equals',
          'not_equals',
          'greater_than',
          'greater_than_or_equal',
          'less_than',
          'less_than_or_equal',
          'exists',
          'does_not_exist'
        },
      MosaicAttributeType.stringList => const {
          'contains_any',
          'contains_all',
          'exists',
          'does_not_exist'
        },
    };

void _validateLeaf(MosaicConditionLeaf leaf,
    Map<String, MosaicAttributeDefinition> definitions) {
  MosaicAttributeType type;
  Set<String> operators;
  Set<String>? closedValues;
  RegExp? pattern;
  switch (leaf.sourceKind) {
    case 'device.platform':
      type = MosaicAttributeType.string;
      operators = const {'equals', 'not_equals', 'in', 'not_in'};
      closedValues = const {'ios', 'android'};
    case 'device.os_version':
    case 'application.version':
      type = MosaicAttributeType.semanticVersion;
      operators = _attributeOperators(type);
    case 'application.locale':
      type = MosaicAttributeType.string;
      operators = const {
        'equals',
        'not_equals',
        'in',
        'not_in',
        'exists',
        'does_not_exist',
        'locale_matches'
      };
    case 'context.country':
      type = MosaicAttributeType.string;
      operators = const {
        'equals',
        'not_equals',
        'in',
        'not_in',
        'exists',
        'does_not_exist'
      };
      pattern = RegExp(r'^[A-Z]{2}$');
    case 'environment.id':
    case 'environment.key':
      type = MosaicAttributeType.string;
      operators = const {'equals', 'not_equals', 'in', 'not_in'};
    case 'identity.user_present':
      type = MosaicAttributeType.boolean;
      operators = const {'equals', 'not_equals'};
    case 'user_attribute':
      final definition = definitions[leaf.sourceKey];
      if (definition == null) {
        throw const MosaicPlacementDecisionException(
            'Condition references an undefined attribute.');
      }
      type = definition.type;
      operators = definition.allowedOperators;
    case 'entitlement_state':
      type = MosaicAttributeType.string;
      operators = const {'equals', 'not_equals', 'in', 'not_in'};
      closedValues = const {
        'active',
        'inactive',
        'unknown',
        'provider_unavailable',
        'failed'
      };
    case 'product_availability':
      type = MosaicAttributeType.string;
      operators = const {'equals', 'not_equals', 'in', 'not_in'};
      closedValues = const {
        'available',
        'unavailable',
        'unknown',
        'provider_unavailable',
        'failed'
      };
    case 'product_readiness':
      type = MosaicAttributeType.string;
      operators = const {'equals', 'not_equals'};
      closedValues = const {'ready', 'not_ready'};
    case 'provider_capability':
      type = MosaicAttributeType.string;
      operators = const {'equals', 'not_equals'};
      closedValues = const {'available', 'unavailable', 'unknown'};
    default:
      throw const MosaicPlacementDecisionException('Unsupported source.');
  }
  if (!operators.contains(leaf.operator)) {
    throw const MosaicPlacementDecisionException(
        'Operator is incompatible with its source.');
  }
  final operand = leaf.operand;
  if (operand == null) return;
  final expectsList = leaf.operator == 'in' || leaf.operator == 'not_in';
  if (expectsList
      ? operand is! MosaicStringListAttribute
      : !_matchesType(type, operand)) {
    throw const MosaicPlacementDecisionException(
        'Operand type is incompatible with its source.');
  }
  final rawValues = operand.value is List
      ? (operand.value as List).cast<Object?>()
      : <Object?>[operand.value];
  if (closedValues != null &&
      rawValues.any((value) => !closedValues!.contains(value))) {
    throw const MosaicPlacementDecisionException(
        'Operand is outside a closed state set.');
  }
  if (pattern != null &&
      rawValues.any((value) => value is! String || !pattern!.hasMatch(value))) {
    throw const MosaicPlacementDecisionException('Operand is not canonical.');
  }
  if (operand is MosaicSemanticVersionAttribute &&
      _semver(operand.value) == null) {
    throw const MosaicPlacementDecisionException(
        'Semantic version is invalid.');
  }
  if (leaf.operator == 'locale_matches' &&
      (operand is! MosaicStringAttribute || !_validLocale(operand.value))) {
    throw const MosaicPlacementDecisionException('Locale range is invalid.');
  }
}

Set<String> _referencedFeatures(MosaicPlacementRuleSet set) {
  final features = <String>{};
  void addOutcome(MosaicDecisionOutcome value) {
    features.add('outcome.${switch (value) {
      MosaicPaywallDecisionOutcome() => 'paywall',
      MosaicNoPaywallDecisionOutcome() => 'no_paywall',
      MosaicFallbackDecisionOutcome() => 'fallback',
      MosaicUnavailableDecisionOutcome() => 'unavailable',
    }}');
  }

  void addNode(MosaicConditionNode value) {
    if (value is MosaicConditionLeaf) {
      features
        ..add('source.${value.sourceKind}')
        ..add('operator.${value.operator}');
    } else if (value is MosaicConditionNot) {
      features.add('condition.not');
      addNode(value.child);
    } else {
      final group = value as MosaicConditionGroup;
      features.add('condition.${group.type}');
      for (final child in group.children) addNode(child);
    }
  }

  addOutcome(set.defaultOutcome);
  for (final fallback in set.fallbacks.values) addOutcome(fallback.outcome);
  for (final override in set.qaOverrides) {
    features.add('override.qa');
    addOutcome(override.outcome);
  }
  for (final rule in set.rules) {
    addOutcome(rule.outcome);
    addNode(rule.conditions);
  }
  return features;
}

bool _matchesType(MosaicAttributeType type, MosaicAttributeValue value) =>
    switch (type) {
      MosaicAttributeType.string => value is MosaicStringAttribute,
      MosaicAttributeType.boolean => value is MosaicBooleanAttribute,
      MosaicAttributeType.number => value is MosaicNumberAttribute,
      MosaicAttributeType.timestamp => value is MosaicTimestampAttribute,
      MosaicAttributeType.semanticVersion =>
        value is MosaicSemanticVersionAttribute,
      MosaicAttributeType.stringList => value is MosaicStringListAttribute,
    };

bool mosaicAttributeMatchesDefinition(
  MosaicAttributeType type,
  MosaicAttributeValue value,
) =>
    _matchesType(type, value);

Map<String, Object?> _map(Object? value) {
  if (value is! Map)
    throw const MosaicPlacementDecisionException('Expected an object.');
  try {
    return value.cast<String, Object?>();
  } on Object {
    throw const MosaicPlacementDecisionException(
        'Object keys must be strings.');
  }
}

List<Object?> _list(Object? value, int maximum, {int minimum = 0}) {
  if (value is! List || value.length < minimum || value.length > maximum)
    throw const MosaicPlacementDecisionException('Invalid list.');
  return value.cast<Object?>();
}

Set<String> _strings(Object? value, int maximum, {int minimum = 0}) {
  final list = _list(value, maximum, minimum: minimum);
  if (list.any((v) => v is! String))
    throw const MosaicPlacementDecisionException('Invalid string list.');
  final result = list.cast<String>().toSet();
  if (result.length != list.length)
    throw const MosaicPlacementDecisionException('Duplicate list item.');
  return result;
}

void _keys(Map<String, Object?> value, Set<String> keys,
    {Set<String> optional = const {}}) {
  final required = keys.difference(optional);
  if (!value.keys.toSet().containsAll(required) ||
      value.keys.any((key) => !keys.contains(key)))
    throw const MosaicPlacementDecisionException(
        'Unexpected or missing field.');
}

void _unique(Iterable<String> values) {
  final list = values.toList();
  if (list.toSet().length != list.length)
    throw const MosaicPlacementDecisionException('Duplicate value.');
}

String _string(Object? value) {
  if (value is! String)
    throw const MosaicPlacementDecisionException('Expected string.');
  return value;
}

String _id(Object? value) {
  final v = _string(value);
  if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$').hasMatch(v))
    throw const MosaicPlacementDecisionException('Invalid identifier.');
  return v;
}

String _key(Object? value) {
  final v = _string(value);
  if (!RegExp(r'^[a-z][a-z0-9_]{0,63}$').hasMatch(v))
    throw const MosaicPlacementDecisionException('Invalid key.');
  return v;
}

String _environmentKey(Object? value) {
  final v = _string(value);
  if (!RegExp(r'^[a-z][a-z0-9_-]{0,63}$').hasMatch(v))
    throw const MosaicPlacementDecisionException('Invalid environment key.');
  return v;
}

bool _bool(Object? value) {
  if (value is! bool)
    throw const MosaicPlacementDecisionException('Expected boolean.');
  return value;
}

int _int(Object? value, int minimum, int maximum) {
  if (value is! int || value < minimum || value > maximum)
    throw const MosaicPlacementDecisionException('Invalid integer.');
  return value;
}

DateTime _time(Object? value) {
  final v = _string(value);
  if (!RegExp(
          r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
      .hasMatch(v))
    throw const MosaicPlacementDecisionException('Invalid timestamp.');
  return DateTime.parse(v).toUtc();
}
