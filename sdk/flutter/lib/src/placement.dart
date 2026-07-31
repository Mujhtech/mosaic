import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'analytics.dart';
import 'analytics_event.dart';
import 'commerce.dart';
import 'commerce_configuration.dart';
import 'configuration.dart';
import 'configuration_client.dart';
import 'configuration_delivery.dart';
import 'customer_entitlements.dart';
import 'experiment_analytics.dart';
import 'experiment_assignment.dart';
import 'placement_decision.dart';
import 'placement_identity.dart';
import 'presentation.dart';
import 'renderer.dart';

sealed class MosaicPlacementResolution {
  const MosaicPlacementResolution();
}

final class MosaicPlacementResolved extends MosaicPlacementResolution {
  const MosaicPlacementResolved({
    required this.placementKey,
    required this.paywallVersion,
    required this.configuration,
    this.decision,
  });

  final String placementKey;
  final MosaicDeliveredPaywallVersion paywallVersion;
  final MosaicAcceptedConfiguration configuration;
  final MosaicPlacementDecisionResult? decision;
}

sealed class MosaicPlacementDecisionResolution {
  const MosaicPlacementDecisionResolution();
}

final class MosaicPlacementDecisionPaywall
    extends MosaicPlacementDecisionResolution {
  const MosaicPlacementDecisionPaywall({
    required this.placementKey,
    required this.paywallVersion,
    required this.configuration,
    required this.decision,
    this.experiment,
    this.experimentFallback,
    this.experimentFallbackReason,
  });
  final String placementKey;
  final MosaicDeliveredPaywallVersion paywallVersion;
  final MosaicAcceptedConfiguration configuration;
  final MosaicPaywallSelected? decision;
  final MosaicExperimentAssigned? experiment;
  final MosaicExperimentAssigned? experimentFallback;
  final String? experimentFallbackReason;
}

final class MosaicPlacementNoPaywall extends MosaicPlacementDecisionResolution {
  const MosaicPlacementNoPaywall(
      {required this.placementKey, required this.decision});
  final String placementKey;
  final MosaicNoPaywallSelected decision;
}

final class MosaicPlacementDecisionUnavailable
    extends MosaicPlacementDecisionResolution {
  const MosaicPlacementDecisionUnavailable({
    required this.placementKey,
    required this.diagnosticCode,
    this.decision,
  });
  final String placementKey;
  final String diagnosticCode;
  final MosaicPlacementDecisionResult? decision;
}

final class MosaicPlacementUnavailable extends MosaicPlacementResolution {
  const MosaicPlacementUnavailable({
    required this.placementKey,
    required this.diagnosticCode,
    this.decision,
  });

  final String placementKey;
  final String diagnosticCode;
  final MosaicPlacementDecisionResult? decision;
}

final class MosaicPlacementDecisionInputs {
  const MosaicPlacementDecisionInputs({
    this.platform,
    this.osVersion,
    this.applicationLocale,
    this.country,
    this.qaOverrideTokens = const <String>{},
    this.now,
  });
  final String? platform;
  final String? osVersion;
  final String? applicationLocale;
  final String? country;
  final Set<String> qaOverrideTokens;
  final DateTime? now;
}

extension MosaicPlacementClient on Mosaic {
  /// Resolves a Placement only from current in-memory configuration.
  ///
  /// This method never performs network or disk I/O.
  MosaicPlacementResolution resolvePlacement(String placementKey) {
    final key = placementKey.trim();
    if (!RegExp(r'^[a-z][a-z0-9_]{0,63}$').hasMatch(key)) {
      return MosaicPlacementUnavailable(
        placementKey: key,
        diagnosticCode: 'placement.invalidKey',
      );
    }
    final configuration = acceptedConfiguration;
    if (configuration == null) {
      return MosaicPlacementUnavailable(
        placementKey: key,
        diagnosticCode: 'configuration.unavailable',
      );
    }
    final version = configuration.envelope.release.paywallForPlacement(key);
    if (version == null) {
      return MosaicPlacementUnavailable(
        placementKey: key,
        diagnosticCode: 'placement.unavailable',
      );
    }
    return MosaicPlacementResolved(
      placementKey: key,
      paywallVersion: version,
      configuration: configuration,
    );
  }

  /// Evaluates a Delivery v2 Placement entirely from the accepted snapshot and
  /// provider observations. It never refreshes configuration.
  Future<MosaicPlacementDecisionResolution> decidePlacement(
    String placementKey, {
    MosaicPlacementDecisionInputs inputs =
        const MosaicPlacementDecisionInputs(),
  }) async {
    final key = placementKey.trim();
    if (!RegExp(r'^[a-z][a-z0-9_]{0,63}$').hasMatch(key)) {
      return MosaicPlacementDecisionUnavailable(
        placementKey: key,
        diagnosticCode: 'placement.invalidKey',
      );
    }
    final accepted = acceptedConfiguration;
    if (accepted == null) {
      return MosaicPlacementDecisionUnavailable(
        placementKey: key,
        diagnosticCode: 'configuration.unavailable',
      );
    }
    final release = accepted.envelope.release;
    final ruleSet = release.decisionForPlacement(key);
    if (ruleSet == null) {
      return switch (resolvePlacement(key)) {
        MosaicPlacementResolved() => MosaicPlacementDecisionPaywall(
            placementKey: key,
            paywallVersion: release.paywallForPlacement(key)!,
            configuration: accepted,
            decision: null,
          ),
        MosaicPlacementUnavailable(:final diagnosticCode) =>
          MosaicPlacementDecisionUnavailable(
            placementKey: key,
            diagnosticCode: diagnosticCode,
          ),
      };
    }
    final MosaicIdentityState identity;
    try {
      identity = await loadIdentity();
    } on Object {
      // Identity is required for deterministic bucketing. A failure here is
      // reported as a safe unavailable decision rather than thrown at the host.
      return MosaicPlacementDecisionUnavailable(
        placementKey: key,
        diagnosticCode: 'identity.unavailable',
      );
    }
    final products = <String, MosaicProductDecisionState>{};
    if (release.productReferences.isNotEmpty) {
      try {
        final loaded =
            await purchaseProvider.loadProducts(release.productReferences.keys);
        if (loaded is MosaicProductsLoaded) {
          final available = loaded.products.map((item) => item.id).toSet();
          final unavailable = loaded.unavailableProductIds.toSet();
          for (final id in release.productReferences.keys) {
            products[id] = available.contains(id)
                ? MosaicProductDecisionState.available
                : unavailable.contains(id)
                    ? MosaicProductDecisionState.unavailable
                    : MosaicProductDecisionState.unknown;
          }
        } else {
          for (final id in release.productReferences.keys) {
            products[id] = MosaicProductDecisionState.unknown;
          }
        }
      } on Object {
        for (final id in release.productReferences.keys) {
          products[id] = MosaicProductDecisionState.unknown;
        }
      }
    }
    final entitlements = <String, MosaicEntitlementDecisionState>{};
    if (release.entitlementReferences.isNotEmpty) {
      final authoritative = customerEntitlements;
      final authority = authoritative?.authority;
      final authorityScopeMatchesRelease = authority != null &&
          release.projectId != null &&
          authority.scope.projectId == release.projectId &&
          authority.scope.environmentId == release.environment.id;
      if (authoritative != null &&
          (authority == null || !authorityScopeMatchesRelease)) {
        // Once authority awareness is configured, absence of an accepted epoch
        // is uncertainty. It must never silently infer source authority.
        for (final reference in release.entitlementReferences.values) {
          entitlements[reference.key] = MosaicEntitlementDecisionState.unknown;
        }
      } else if (authoritative != null && authority!.isMosaic) {
        // Mosaic authority is exclusive: provider-observed grants are not
        // unioned into this decision input.
        for (final reference in release.entitlementReferences.values) {
          final check = authoritative.checkCustomerEntitlement(reference.key);
          entitlements[reference.key] = switch (check.state) {
            MosaicCustomerAccessState.active =>
              MosaicEntitlementDecisionState.active,
            MosaicCustomerAccessState.inactive =>
              MosaicEntitlementDecisionState.inactive,
            MosaicCustomerAccessState.unknown ||
            MosaicCustomerAccessState.unavailable =>
              MosaicEntitlementDecisionState.unknown,
          };
        }
      } else {
        // Source and source-rollback epochs deliberately continue to use the
        // purchase Provider. The authority snapshot is transition evidence,
        // never another entitlement set to merge.
        try {
          final observed = await purchaseProvider.activeEntitlements();
          switch (observed) {
            case MosaicActiveEntitlements():
              final active =
                  observed.entitlements.map((item) => item.id).toSet();
              for (final reference in release.entitlementReferences.values) {
                entitlements[reference.key] = active.contains(reference.key)
                    ? MosaicEntitlementDecisionState.active
                    : MosaicEntitlementDecisionState.inactive;
              }
            case MosaicEntitlementsProviderUnavailable():
              for (final reference in release.entitlementReferences.values) {
                entitlements[reference.key] =
                    MosaicEntitlementDecisionState.providerUnavailable;
              }
            case MosaicEntitlementsFailed():
              for (final reference in release.entitlementReferences.values) {
                entitlements[reference.key] =
                    MosaicEntitlementDecisionState.failed;
              }
            case MosaicEntitlementsUnknown():
              for (final reference in release.entitlementReferences.values) {
                entitlements[reference.key] =
                    MosaicEntitlementDecisionState.unknown;
              }
          }
        } on Object {
          for (final reference in release.entitlementReferences.values) {
            entitlements[reference.key] = MosaicEntitlementDecisionState.failed;
          }
        }
      }
    }
    final providerCapabilities = <String, MosaicProviderCapabilityState>{
      'product_loading': MosaicProviderCapabilityState.available,
      'purchase': MosaicProviderCapabilityState.available,
      'restore': MosaicProviderCapabilityState.available,
      'entitlement_lookup': MosaicProviderCapabilityState.available,
    };
    if (purchaseProvider case final MosaicCommerceProvider provider) {
      bool supported(MosaicProviderCapabilityName name) =>
          provider.capabilities.any((value) =>
              value.name == name &&
              value.support == MosaicProviderCapabilitySupport.supported);
      providerCapabilities
        ..['product_loading'] =
            supported(MosaicProviderCapabilityName.productLoading)
                ? MosaicProviderCapabilityState.available
                : MosaicProviderCapabilityState.unavailable
        ..['restore'] = supported(MosaicProviderCapabilityName.restore)
            ? MosaicProviderCapabilityState.available
            : MosaicProviderCapabilityState.unavailable
        ..['entitlement_lookup'] =
            supported(MosaicProviderCapabilityName.activeEntitlementLookup)
                ? MosaicProviderCapabilityState.available
                : MosaicProviderCapabilityState.unavailable;
    }
    final context = MosaicDecisionContext(
      platform: inputs.platform ?? _flutterPlatform,
      osVersion: inputs.osVersion,
      applicationVersion: configuration.applicationVersion,
      applicationLocale: inputs.applicationLocale,
      country: inputs.country,
      userPresent: identity.userId != null,
      attributes: identity.attributes,
      entitlements: entitlements,
      products: products,
      productReadiness: <String, MosaicProductReadiness>{
        for (final product in release.productReferences.values)
          product.id: product.readiness == MosaicDeliveredProductReadiness.ready
              ? MosaicProductReadiness.ready
              : MosaicProductReadiness.notReady,
      },
      providerCapabilities: providerCapabilities,
      qaOverrideTokens: inputs.qaOverrideTokens,
      now: inputs.now,
    );
    final assignment = switch (ruleSet.assignmentPolicy) {
      MosaicAssignmentPolicy.installation => MosaicAssignmentKey(
          type: 'installation', value: identity.installationId),
      MosaicAssignmentPolicy.identifiedUser => identity.userId == null
          ? null
          : MosaicAssignmentKey(
              type: 'identified_user', value: identity.userId!),
      MosaicAssignmentPolicy.identifiedUserOrInstallation =>
        identity.userId == null
            ? MosaicAssignmentKey(
                type: 'installation', value: identity.installationId)
            : MosaicAssignmentKey(
                type: 'identified_user', value: identity.userId!),
    };
    var decision = const MosaicPlacementDecisionEvaluator().evaluate(
      ruleSet: ruleSet,
      context: context,
      assignment: assignment,
    );
    while (decision is MosaicPaywallSelected) {
      final version = release.paywallVersions[decision.paywallVersionId];
      final selectedOutcome = decision.fallbackPath.isNotEmpty
          ? ruleSet.fallbacks[decision.fallbackPath.last]?.outcome
          : decision.matchedRuleId == null
              ? ruleSet.defaultOutcome
              : ruleSet.rules
                  .firstWhere((rule) => rule.id == decision.matchedRuleId)
                  .outcome;
      final fallbackKey = selectedOutcome is MosaicPaywallDecisionOutcome
          ? selectedOutcome.unavailableFallbackKey
          : null;
      String? trigger;
      if (version == null) {
        trigger = 'content_unavailable';
      } else {
        for (final productId in version.productReferenceIds) {
          if (release.productReferences[productId]?.readiness !=
                  MosaicDeliveredProductReadiness.ready ||
              products[productId] != MosaicProductDecisionState.available) {
            trigger = 'commerce_unavailable';
            break;
          }
        }
      }
      if (trigger != null && fallbackKey != null) {
        decision = const MosaicPlacementDecisionEvaluator().followFallback(
          ruleSet: ruleSet,
          fallbackKey: fallbackKey,
          previous: decision,
          trigger: trigger,
        );
        continue;
      } else if (trigger != null) {
        return MosaicPlacementDecisionUnavailable(
          placementKey: key,
          diagnosticCode: 'placement.$trigger',
          decision: decision,
        );
      }
      break;
    }
    if (decision is MosaicPaywallSelected) {
      var version = release.paywallVersions[decision.paywallVersionId];
      MosaicExperimentAssigned? experimentResult;
      MosaicExperimentAssigned? experimentFallback;
      String? experimentFallbackReason;
      final experiments = release
          .experimentsForPlacement(ruleSet.placementId)
          .where((candidate) =>
              version != null &&
              version.id == candidate.controlPaywallVersionId);
      for (final experiment in experiments) {
        final evaluated = const MosaicExperimentAssignmentEngine().evaluate(
            assignment: experiment,
            identity: identity,
            trustedNow: inputs.now,
            qaTokens: inputs.qaOverrideTokens);
        if (evaluated is MosaicExperimentAssigned) {
          final assignmentValue =
              evaluated.assignmentKeyType == 'identified_user'
                  ? identity.userId!
                  : identity.installationId;
          final store = experimentAssignmentStore;
          if (store != null) {
            unawaited(store
                .record(evaluated, assignmentValue)
                .catchError((Object _) {}));
          }
          final candidate =
              release.paywallVersions[evaluated.variant.paywallVersionId];
          final requiredProductsReady = candidate != null &&
              evaluated.variant.requiredProductIds.every((productId) =>
                  candidate.productReferenceIds.contains(productId) &&
                  release.productReferences[productId]?.readiness ==
                      MosaicDeliveredProductReadiness.ready &&
                  products[productId] == MosaicProductDecisionState.available);
          final requiredProviderReady = evaluated
              .variant.requiredProviderCapabilities
              .every((capability) => switch (capability) {
                    'product_load' => providerCapabilities['product_loading'] ==
                        MosaicProviderCapabilityState.available,
                    'purchase' => providerCapabilities['purchase'] ==
                        MosaicProviderCapabilityState.available,
                    'restore' => providerCapabilities['restore'] ==
                        MosaicProviderCapabilityState.available,
                    'entitlement_lookup' =>
                      providerCapabilities['entitlement_lookup'] ==
                          MosaicProviderCapabilityState.available,
                    'native_recovery' => false,
                    _ => false,
                  });
          if (candidate != null &&
              requiredProductsReady &&
              requiredProviderReady) {
            version = candidate;
            experimentResult = evaluated;
          } else {
            experimentFallback = evaluated;
            experimentFallbackReason = candidate == null
                ? 'configuration_incompatible'
                : !requiredProductsReady
                    ? 'product_unavailable'
                    : 'provider_unavailable';
          }
          // Admission selected this Experiment. Product/provider/render
          // failure falls back to the normal Placement and must not select a
          // different member of the same mutual-exclusion group.
          break;
        }
      }
      return version == null
          ? MosaicPlacementDecisionUnavailable(
              placementKey: key,
              diagnosticCode: 'placement.contentUnavailable',
              decision: decision,
            )
          : MosaicPlacementDecisionPaywall(
              placementKey: key,
              paywallVersion: version,
              configuration: accepted,
              decision: decision,
              experiment: experimentResult,
              experimentFallback: experimentFallback,
              experimentFallbackReason: experimentFallbackReason,
            );
    }
    return switch (decision) {
      MosaicPaywallSelected() => throw StateError('Unreachable decision.'),
      MosaicNoPaywallSelected() =>
        MosaicPlacementNoPaywall(placementKey: key, decision: decision),
      MosaicDecisionUnavailable() => MosaicPlacementDecisionUnavailable(
          placementKey: key,
          diagnosticCode: 'placement.${decision.reason}',
          decision: decision,
        ),
    };
  }
}

String get _flutterPlatform => switch (defaultTargetPlatform) {
      TargetPlatform.iOS => 'ios',
      TargetPlatform.android => 'android',
      _ => 'unknown',
    };

/// Cache-first native Placement host. Loading never triggers a remote fetch.
final class MosaicPlacementHost extends StatefulWidget {
  const MosaicPlacementHost({
    required this.mosaic,
    required this.placementKey,
    required this.onResult,
    this.requestedLocale,
    this.imageResolver,
    this.videoResolver,
    this.onInteraction,
    this.onDiagnostic,
    this.externalUrlOpener = mosaicExternalUrlOpener,
    this.loadingBuilder,
    this.unavailableBuilder,
    super.key,
  });

  final Mosaic mosaic;
  final String placementKey;
  final String? requestedLocale;
  final MosaicBundledImageResolver? imageResolver;
  final MosaicBundledVideoResolver? videoResolver;
  final MosaicPresentationResultCallback onResult;
  final MosaicInteractionCallback? onInteraction;
  final MosaicDiagnosticCallback? onDiagnostic;
  final MosaicExternalUrlOpener externalUrlOpener;
  final WidgetBuilder? loadingBuilder;
  final Widget Function(BuildContext, MosaicPlacementUnavailable)?
      unavailableBuilder;

  @override
  State<MosaicPlacementHost> createState() => _MosaicPlacementHostState();
}

final class _MosaicPlacementHostState extends State<MosaicPlacementHost> {
  late Future<MosaicConfigurationLoadResult> _load;
  Future<MosaicPlacementDecisionResolution>? _decision;
  String? _reportedUnavailableKey;
  String _placementRequestId = mosaicAnalyticsId('placement_request');
  String _paywallPresentationId = mosaicAnalyticsId('presentation');
  final Set<String> _analyticsEvents = <String>{};

  @override
  void initState() {
    super.initState();
    widget.mosaic.addListener(_configurationChanged);
    _load = widget.mosaic.loadConfiguration();
  }

  @override
  void didUpdateWidget(MosaicPlacementHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.mosaic != widget.mosaic) {
      oldWidget.mosaic.removeListener(_configurationChanged);
      widget.mosaic.addListener(_configurationChanged);
      _load = widget.mosaic.loadConfiguration();
      _decision = null;
    }
    if (oldWidget.placementKey != widget.placementKey ||
        oldWidget.requestedLocale != widget.requestedLocale) {
      _reportedUnavailableKey = null;
      _decision = null;
      _placementRequestId = mosaicAnalyticsId('placement_request');
      _paywallPresentationId = mosaicAnalyticsId('presentation');
      _analyticsEvents.clear();
    }
  }

  @override
  void dispose() {
    widget.mosaic.removeListener(_configurationChanged);
    super.dispose();
  }

  void _configurationChanged() {
    if (mounted) setState(() => _decision = null);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<MosaicConfigurationLoadResult>(
      future: _load,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return widget.loadingBuilder?.call(context) ??
              const SizedBox.shrink();
        }
        if (widget.mosaic.acceptedConfiguration?.envelope.release
                .placementDecisions.isEmpty ??
            true) {
          final resolution =
              widget.mosaic.resolvePlacement(widget.placementKey);
          return switch (resolution) {
            MosaicPlacementResolved() => _paywall(resolution),
            MosaicPlacementUnavailable() => _unavailable(context, resolution),
          };
        }
        _decision ??= widget.mosaic.decidePlacement(
          widget.placementKey,
          inputs: MosaicPlacementDecisionInputs(
            applicationLocale: widget.requestedLocale,
            now: widget.mosaic.acceptedConfiguration?.trustedNow,
          ),
        );
        return FutureBuilder<MosaicPlacementDecisionResolution>(
          future: _decision,
          builder: (context, decisionSnapshot) {
            if (!decisionSnapshot.hasData) {
              if (decisionSnapshot.hasError) {
                return _evaluationFailed(context);
              }
              return widget.loadingBuilder?.call(context) ??
                  const SizedBox.shrink();
            }
            final resolution = decisionSnapshot.requireData;
            return switch (resolution) {
              MosaicPlacementDecisionPaywall() => _decisionPaywall(resolution),
              MosaicPlacementDecisionUnavailable() =>
                _decisionUnavailable(context, resolution),
              MosaicPlacementNoPaywall() => _noPaywall(resolution),
            };
          },
        );
      },
    );
  }

  Widget _paywall(MosaicPlacementResolved resolution) {
    final analytics = _analyticsContext(
      resolution.configuration,
      resolution.paywallVersion,
      decision: resolution.decision,
    );
    _recordPlacement(
      resolution.configuration,
      MosaicAnalyticsEventName.placementPaywallSelected,
      analytics.attribution,
      const <String, Object?>{
        'finalOutcome': 'paywall',
        'decisionContractVersion': '1',
      },
    );
    return MosaicPaywall(
      key: ValueKey<String>(
        '${resolution.configuration.envelope.release.id}:'
        '${resolution.paywallVersion.id}',
      ),
      document: resolution.paywallVersion.document,
      purchaseProvider: widget.mosaic.purchaseProvider,
      requestedLocale: widget.requestedLocale,
      imageResolver: widget.imageResolver,
      videoResolver: widget.videoResolver,
      onResult: widget.onResult,
      onInteraction: widget.onInteraction,
      onDiagnostic: widget.onDiagnostic,
      analyticsRuntime: widget.mosaic.analytics,
      transactionObservations: widget.mosaic.transactionObservations,
      analyticsContext: analytics,
      externalUrlOpener: widget.externalUrlOpener,
    );
  }

  Widget _decisionPaywall(MosaicPlacementDecisionPaywall resolution) {
    final analytics = _analyticsContext(
      resolution.configuration,
      resolution.paywallVersion,
      decision: resolution.decision,
      conversionExperiment: mosaicConversionExperimentAttribution(resolution),
    );
    final decision = resolution.decision;
    if (decision?.usedFallback == true) {
      _recordPlacement(
        resolution.configuration,
        MosaicAnalyticsEventName.placementFallbackUsed,
        analytics.attribution,
        <String, Object?>{
          'trigger': _fallbackTrigger(
            decision!,
            resolution.configuration.envelope.release
                .decisionForPlacement(resolution.placementKey),
          ),
          'fallbackKey': decision.fallbackPath.last,
          'finalOutcome': 'paywall',
        },
      );
    }
    _recordPlacement(
      resolution.configuration,
      MosaicAnalyticsEventName.placementPaywallSelected,
      analytics.attribution,
      <String, Object?>{
        'finalOutcome': 'paywall',
        'decisionContractVersion': '1',
        // Rollout attribution is atomic: the key type, algorithm, and bucket
        // are emitted together or not at all, matching the canonical contract.
        if (decision?.rolloutBucket != null &&
            decision?.assignmentKeyType != null) ...<String, Object?>{
          'assignmentKeyType': decision!.assignmentKeyType,
          'rolloutBucket': decision.rolloutBucket,
          'bucketingAlgorithm': mosaicRolloutAlgorithm,
        },
      },
    );
    final experiment = resolution.experiment;
    final fallback = resolution.experimentFallback;
    final assignedExperiment = experiment ?? fallback;
    if (assignedExperiment != null &&
        _analyticsEvents.add('experiment_assigned')) {
      final sink = widget.mosaic.experimentAnalytics;
      if (sink != null) {
        unawaited(sink
            .enqueue(mosaicExperimentAnalyticsEvent(
              name: MosaicExperimentAnalyticsEventName.assigned,
              assigned: assignedExperiment,
              placementRequestId: _placementRequestId,
              configurationReleaseId:
                  resolution.configuration.envelope.release.id,
              placementId: assignedExperiment.assignment.placementId,
              payload: <String, Object?>{
                'assignmentKeyType': assignedExperiment.assignmentKeyType,
                'bucketingAlgorithm': mosaicExperimentBucketingAlgorithm,
                'bucket': assignedExperiment.bucket,
                'source': assignedExperiment.qaOverride
                    ? 'qa_override'
                    : 'deterministic',
              },
            ))
            .catchError((Object _) {}));
      }
    }
    return MosaicPaywall(
      key: ValueKey<String>(
        '${resolution.configuration.envelope.release.id}:'
        '${resolution.paywallVersion.id}',
      ),
      document: resolution.paywallVersion.document,
      purchaseProvider: widget.mosaic.purchaseProvider,
      requestedLocale: widget.requestedLocale,
      imageResolver: widget.imageResolver,
      videoResolver: widget.videoResolver,
      onResult: widget.onResult,
      onInteraction: widget.onInteraction,
      onDiagnostic: widget.onDiagnostic,
      analyticsRuntime: widget.mosaic.analytics,
      transactionObservations: widget.mosaic.transactionObservations,
      analyticsContext: analytics,
      onPresented: experiment == null || experiment.qaOverride
          ? fallback == null || fallback.qaOverride
              ? null
              : () {
                  if (!_analyticsEvents.add('experiment_fallback_presented')) {
                    return;
                  }
                  final sink = widget.mosaic.experimentAnalytics;
                  if (sink == null) return;
                  unawaited(sink
                      .enqueue(mosaicExperimentAnalyticsEvent(
                        name: MosaicExperimentAnalyticsEventName
                            .fallbackPresented,
                        assigned: fallback,
                        placementRequestId: _placementRequestId,
                        paywallPresentationId: _paywallPresentationId,
                        configurationReleaseId:
                            resolution.configuration.envelope.release.id,
                        placementId: fallback.assignment.placementId,
                        payload: <String, Object?>{
                          'reason': resolution.experimentFallbackReason!,
                          'presentedPaywallId':
                              resolution.paywallVersion.paywallId,
                          'presentedPaywallVersionId':
                              resolution.paywallVersion.id,
                        },
                      ))
                      .catchError((Object _) {}));
                }
          : () {
              if (!_analyticsEvents.add('experiment_exposed')) return;
              final store = widget.mosaic.experimentAssignmentStore;
              if (store != null) {
                unawaited(widget.mosaic.loadIdentity().then((identity) {
                  final value =
                      experiment.assignmentKeyType == 'identified_user'
                          ? identity.userId
                          : identity.installationId;
                  if (value != null) {
                    return store.markExposed(experiment, value);
                  }
                }).catchError((Object _) {}));
              }
              final sink = widget.mosaic.experimentAnalytics;
              if (sink == null) return;
              unawaited(sink
                  .enqueue(mosaicExperimentAnalyticsEvent(
                    name: MosaicExperimentAnalyticsEventName.exposed,
                    assigned: experiment,
                    placementRequestId: _placementRequestId,
                    paywallPresentationId: _paywallPresentationId,
                    configurationReleaseId:
                        resolution.configuration.envelope.release.id,
                    placementId: experiment.assignment.placementId,
                    paywallId: experiment.variant.paywallId,
                    paywallVersionId: experiment.variant.paywallVersionId,
                    payload: <String, Object?>{
                      'assignmentKeyType': experiment.assignmentKeyType,
                      'bucketingAlgorithm': mosaicExperimentBucketingAlgorithm,
                      'productReadiness': 'ready',
                      'providerCapability': 'accepted',
                    },
                  ))
                  .catchError((Object _) {}));
            },
      externalUrlOpener: widget.externalUrlOpener,
    );
  }

  Widget _decisionUnavailable(
    BuildContext context,
    MosaicPlacementDecisionUnavailable resolution,
  ) =>
      _unavailable(
        context,
        MosaicPlacementUnavailable(
          placementKey: resolution.placementKey,
          diagnosticCode: resolution.diagnosticCode,
          decision: resolution.decision,
        ),
      );

  Widget _noPaywall(MosaicPlacementNoPaywall resolution) {
    final accepted = widget.mosaic.acceptedConfiguration;
    if (accepted != null) {
      final ruleSet = accepted.envelope.release
          .decisionForPlacement(resolution.placementKey);
      final attribution = MosaicAnalyticsAttribution(
        configurationReleaseId: accepted.envelope.release.id,
        placementId: ruleSet?.placementId,
        placementRuleSetId: ruleSet?.id,
        placementRuleSetVersion: ruleSet?.version,
        winningRuleId: resolution.decision.matchedRuleId,
      );
      if (resolution.decision.fallbackPath.isNotEmpty) {
        _recordPlacement(
          accepted,
          MosaicAnalyticsEventName.placementFallbackUsed,
          attribution,
          <String, Object?>{
            'trigger': _fallbackTrigger(resolution.decision, ruleSet),
            'fallbackKey': resolution.decision.fallbackPath.last,
            'finalOutcome': 'no_paywall',
          },
        );
      }
      _recordPlacement(
        accepted,
        MosaicAnalyticsEventName.placementNoPaywall,
        attribution,
        <String, Object?>{
          'finalOutcome': 'no_paywall',
          'decisionContractVersion': '1',
          if (resolution.decision.rolloutBucket != null &&
              resolution.decision.assignmentKeyType !=
                  null) ...<String, Object?>{
            'assignmentKeyType': resolution.decision.assignmentKeyType,
            'rolloutBucket': resolution.decision.rolloutBucket,
            'bucketingAlgorithm': mosaicRolloutAlgorithm,
          },
        },
      );
    }
    final reportKey = '${resolution.placementKey}:no_paywall';
    if (_reportedUnavailableKey != reportKey) {
      _reportedUnavailableKey = reportKey;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _reportedUnavailableKey != reportKey) return;
        widget.onResult(MosaicNoPaywallPresentationResult(
          placementKey: resolution.placementKey,
          decision: resolution.decision,
        ));
      });
    }
    return const SizedBox.shrink();
  }

  Widget _unavailable(
    BuildContext context,
    MosaicPlacementUnavailable resolution,
  ) {
    final accepted = widget.mosaic.acceptedConfiguration;
    if (accepted != null) {
      final ruleSet = accepted.envelope.release
          .decisionForPlacement(resolution.placementKey);
      _recordPlacement(
        accepted,
        MosaicAnalyticsEventName.placementUnavailable,
        MosaicAnalyticsAttribution(
          configurationReleaseId: accepted.envelope.release.id,
          placementId: ruleSet?.placementId,
          placementRuleSetId: ruleSet?.id,
          placementRuleSetVersion: ruleSet?.version,
        ),
        <String, Object?>{
          'reason': _analyticsUnavailableReason(resolution.diagnosticCode),
          'diagnosticCode': 'placement.unavailable',
        },
      );
    }
    final reportKey = '${resolution.placementKey}:${resolution.diagnosticCode}';
    if (_reportedUnavailableKey != reportKey) {
      _reportedUnavailableKey = reportKey;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _reportedUnavailableKey != reportKey) return;
        widget.onDiagnostic?.call(
          MosaicDiagnostic(
            code: resolution.diagnosticCode,
            message: 'The requested Mosaic Placement is unavailable.',
            severity: MosaicDiagnosticSeverity.error,
          ),
        );
        widget.onResult(
          resolution.diagnosticCode == 'configuration.unavailable'
              ? MosaicConfigurationUnavailablePresentationResult(
                  diagnosticCode: resolution.diagnosticCode,
                )
              : MosaicPlacementUnavailablePresentationResult(
                  placementKey: resolution.placementKey,
                  diagnosticCode: resolution.diagnosticCode,
                ),
        );
      });
    }
    return widget.unavailableBuilder?.call(context, resolution) ??
        const SizedBox.shrink();
  }

  Widget _evaluationFailed(BuildContext context) {
    final accepted = widget.mosaic.acceptedConfiguration;
    final ruleSet =
        accepted?.envelope.release.decisionForPlacement(widget.placementKey);
    if (accepted != null && ruleSet != null) {
      _recordPlacement(
        accepted,
        MosaicAnalyticsEventName.placementEvaluationFailed,
        MosaicAnalyticsAttribution(
          configurationReleaseId: accepted.envelope.release.id,
          placementId: ruleSet.placementId,
          placementRuleSetId: ruleSet.id,
          placementRuleSetVersion: ruleSet.version,
        ),
        const <String, Object?>{
          'diagnosticCode': 'decision.evaluation_failed',
          'retryable': false,
        },
      );
    }
    const resolution = MosaicPlacementUnavailable(
      placementKey: '',
      diagnosticCode: 'placement.evaluationFailed',
    );
    final reportKey = '${widget.placementKey}:evaluation_failed';
    if (_reportedUnavailableKey != reportKey) {
      _reportedUnavailableKey = reportKey;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _reportedUnavailableKey != reportKey) return;
        widget.onDiagnostic?.call(
          const MosaicDiagnostic(
            code: 'placement.evaluationFailed',
            message: 'The Mosaic Placement could not be evaluated.',
            severity: MosaicDiagnosticSeverity.error,
          ),
        );
        widget.onResult(
          const MosaicRenderingFailedPresentationResult(
            diagnosticCode: 'placement.evaluationFailed',
          ),
        );
      });
    }
    return widget.unavailableBuilder?.call(context, resolution) ??
        const SizedBox.shrink();
  }

  MosaicAnalyticsPresentationContext _analyticsContext(
    MosaicAcceptedConfiguration configuration,
    MosaicDeliveredPaywallVersion paywallVersion, {
    MosaicPlacementDecisionResult? decision,
    MosaicExperimentAttribution? conversionExperiment,
  }) {
    final release = configuration.envelope.release;
    final ruleSet = release.decisionForPlacement(widget.placementKey);
    final commerce = configuration.commerceEnvelope?.configuration;
    return MosaicAnalyticsPresentationContext(
      placementRequestId: _placementRequestId,
      paywallPresentationId: _paywallPresentationId,
      attribution: MosaicAnalyticsAttribution(
        configurationReleaseId: release.id,
        placementId: ruleSet?.placementId,
        placementRuleSetId: ruleSet?.id,
        placementRuleSetVersion: ruleSet?.version,
        winningRuleId: decision?.matchedRuleId,
        paywallId: paywallVersion.paywallId,
        paywallVersionId: paywallVersion.id,
      ),
      providerId: commerce?.activeProvider.identity.id,
      providerProductMappingIds: <String, String>{
        for (final mapping in commerce?.productMappings ??
            const <MosaicCommerceProductMapping>[])
          mapping.mosaicProductId: mapping.mappingId,
      },
      experiment: conversionExperiment,
    );
  }

  void _recordPlacement(
    MosaicAcceptedConfiguration configuration,
    MosaicAnalyticsEventName outcome,
    MosaicAnalyticsAttribution attribution,
    Map<String, Object?> payload,
  ) {
    final runtime = widget.mosaic.analytics;
    if (runtime == null) return;
    if (_analyticsEvents.add('requested')) {
      unawaited(runtime.record(
        name: MosaicAnalyticsEventName.placementRequested,
        correlation: MosaicAnalyticsCorrelation(
          placementRequestId: _placementRequestId,
        ),
        attribution: MosaicAnalyticsAttribution(
          configurationReleaseId: configuration.envelope.release.id,
          placementId: attribution.placementId,
          placementRuleSetId: attribution.placementRuleSetId,
          placementRuleSetVersion: attribution.placementRuleSetVersion,
        ),
        payload: const <String, Object?>{'decisionContractVersion': '1'},
      ).catchError((Object _) => false));
    }
    if (_analyticsEvents.add(outcome.wireValue)) {
      unawaited(runtime
          .record(
            name: outcome,
            correlation: MosaicAnalyticsCorrelation(
              placementRequestId: _placementRequestId,
            ),
            attribution: attribution,
            payload: payload,
          )
          .catchError((Object _) => false));
    }
  }

  String _analyticsUnavailableReason(String code) {
    if (code.contains('configuration')) return 'configuration_incompatible';
    if (code.contains('commerce')) return 'commerce_unavailable';
    if (code.contains('content')) return 'content_unavailable';
    return 'no_safe_decision';
  }

  String _fallbackTrigger(
    MosaicPlacementDecisionResult decision,
    MosaicPlacementRuleSet? ruleSet,
  ) {
    final triggered = decision.trace
        .where((step) => step.code == 'fallback.triggered')
        .lastOrNull;
    if (triggered != null) {
      final message = triggered.message;
      return message.substring(
          'Fallback was triggered by '.length, message.length - 1);
    }
    final rule = ruleSet?.rules
        .where((candidate) => candidate.id == decision.matchedRuleId)
        .firstOrNull;
    return _conditionFallbackTrigger(rule?.conditions) ?? 'unsafe_rendering';
  }

  String? _conditionFallbackTrigger(MosaicConditionNode? node) {
    return switch (node) {
      MosaicConditionLeaf(:final sourceKind, :final operand) => switch ((
          sourceKind,
          operand?.value
        )) {
          ('product_availability', 'unavailable') => 'product_unavailable',
          ('product_availability', 'unknown') => 'product_unknown',
          ('provider_capability', 'unavailable') => 'provider_unavailable',
          ('entitlement_state', 'unknown') => 'entitlement_unknown',
          _ => null,
        },
      MosaicConditionGroup(:final children) =>
        children.map(_conditionFallbackTrigger).nonNulls.firstOrNull,
      MosaicConditionNot(:final child) => _conditionFallbackTrigger(child),
      _ => null,
    };
  }
}

/// The Experiment tuple that conversion events from [resolution] must carry, or
/// `null` when they must be emitted without one.
///
/// Only a successfully exposed original-Variant presentation may attribute a
/// conversion to a Variant:
///
/// * a fallback presentation shows the normal Placement, and a tuple-carrying
///   conversion would enter the `product_selection_purchase_start` denominator
///   and can displace the Variant's own row, counting a normal-Paywall outcome
///   as a Variant outcome; and
/// * a QA override deliberately emits no statistical exposure, so its
///   conversions must not appear in Variant results either.
MosaicExperimentAttribution? mosaicConversionExperimentAttribution(
  MosaicPlacementDecisionPaywall resolution,
) {
  final experiment = resolution.experiment;
  if (experiment == null || experiment.qaOverride) return null;
  return MosaicExperimentAttribution(
    experimentId: experiment.assignment.experimentId,
    experimentVersionId: experiment.assignment.experimentVersionId,
    experimentVariantId: experiment.variant.id,
    experimentAllocationVersion: experiment.assignment.allocationVersion,
  );
}
