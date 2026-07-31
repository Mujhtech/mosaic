import 'package:flutter/material.dart';

import 'configuration.dart';
import 'configuration_client.dart';
import 'configuration_delivery.dart';
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
  });

  final String placementKey;
  final MosaicDeliveredPaywallVersion paywallVersion;
  final MosaicAcceptedConfiguration configuration;
}

final class MosaicPlacementUnavailable extends MosaicPlacementResolution {
  const MosaicPlacementUnavailable({
    required this.placementKey,
    required this.diagnosticCode,
  });

  final String placementKey;
  final String diagnosticCode;
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
}

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
    }
    if (oldWidget.placementKey != widget.placementKey) {
      _reportedUnavailableKey = null;
    }
  }

  @override
  void dispose() {
    widget.mosaic.removeListener(_configurationChanged);
    super.dispose();
  }

  void _configurationChanged() {
    if (mounted) setState(() {});
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
        final resolution = widget.mosaic.resolvePlacement(widget.placementKey);
        return switch (resolution) {
          MosaicPlacementResolved() => MosaicPaywall(
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
            ),
          MosaicPlacementUnavailable() => _unavailable(context, resolution),
        };
      },
    );
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
