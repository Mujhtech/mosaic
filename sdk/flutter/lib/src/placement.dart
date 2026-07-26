import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'commerce.dart';
import 'commerce_configuration.dart';
import 'configuration.dart';
import 'configuration_client.dart';
import 'configuration_delivery.dart';
import 'placement_decision.dart';
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
  });
  final String placementKey;
  final MosaicDeliveredPaywallVersion paywallVersion;
  final MosaicAcceptedConfiguration configuration;
  final MosaicPaywallSelected? decision;
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
    final identity = await loadIdentity();
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
      try {
        final observed = await purchaseProvider.activeEntitlements();
        switch (observed) {
          case MosaicActiveEntitlements():
            final active = observed.entitlements.map((item) => item.id).toSet();
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
      final version = release.paywallVersions[decision.paywallVersionId];
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
          ),
        );
        return FutureBuilder<MosaicPlacementDecisionResolution>(
          future: _decision,
          builder: (context, decisionSnapshot) {
            if (!decisionSnapshot.hasData) {
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

  Widget _paywall(MosaicPlacementResolved resolution) => MosaicPaywall(
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
        externalUrlOpener: widget.externalUrlOpener,
      );

  Widget _decisionPaywall(MosaicPlacementDecisionPaywall resolution) =>
      MosaicPaywall(
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
        externalUrlOpener: widget.externalUrlOpener,
      );

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
}
