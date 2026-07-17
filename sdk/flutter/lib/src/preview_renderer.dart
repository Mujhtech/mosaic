import 'package:flutter/material.dart';

import 'commerce.dart';
import 'presentation.dart';
import 'preview_client.dart';
import 'preview_commerce.dart';
import 'preview_protocol.dart';
import 'protocol.dart';
import 'renderer.dart';

/// Renders the latest safe local-preview revision with native Flutter widgets.
final class MosaicPreviewPaywall extends StatefulWidget {
  const MosaicPreviewPaywall({
    required this.client,
    required this.fallbackDocument,
    required this.fallbackPurchaseProvider,
    required this.onResult,
    this.imageResolver,
    this.onInteraction,
    this.onDiagnostic,
    super.key,
  });

  final MosaicPreviewClient client;
  final MosaicPaywallDocument fallbackDocument;
  final MosaicPurchaseProvider fallbackPurchaseProvider;
  final MosaicBundledImageResolver? imageResolver;
  final MosaicPresentationResultCallback onResult;
  final MosaicInteractionCallback? onInteraction;
  final MosaicDiagnosticCallback? onDiagnostic;

  @override
  State<MosaicPreviewPaywall> createState() => _MosaicPreviewPaywallState();
}

final class _MosaicPreviewPaywallState extends State<MosaicPreviewPaywall> {
  Object? _providerKey;
  MosaicPurchaseProvider? _previewProvider;
  final Set<String> _reportedWarningKeys = <String>{};

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.client,
      builder: (context, _) {
        final document =
            widget.client.documentForRendering ?? widget.fallbackDocument;
        final revision = widget.client.revisionForRendering;
        final previewContext = widget.client.previewContextForRendering;
        final commerceRevision = widget.client.mockCommerceRevision;
        final mockCommerce = widget.client.mockCommerceState;
        final purchaseProvider = mockCommerce == null
            ? widget.fallbackPurchaseProvider
            : _providerFor(
                document,
                mockCommerce,
                commerceRevision,
              );
        final renderKey = Object.hash(
          revision?.revisionId,
          revision?.sequence,
          commerceRevision?.revisionId,
          commerceRevision?.sequence,
          previewContext?.locale,
          previewContext?.textScale,
          document.id,
          document.revision,
        );
        if (revision != null && widget.client.pendingRevision == revision) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              widget.client.markRevisionRendered(revision);
            }
          });
        }
        final media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(
            textScaler: TextScaler.linear(previewContext?.textScale ?? 1),
          ),
          child: MosaicPaywall(
            key: ValueKey<int>(renderKey),
            document: document,
            purchaseProvider: purchaseProvider,
            requestedLocale: previewContext?.locale,
            imageResolver: widget.imageResolver,
            onResult: widget.onResult,
            onInteraction: widget.onInteraction,
            onDiagnostic: (diagnostic) {
              widget.onDiagnostic?.call(diagnostic);
              if (diagnostic.severity == MosaicDiagnosticSeverity.warning) {
                _reportWarning(diagnostic, revision);
              }
            },
          ),
        );
      },
    );
  }

  MosaicPurchaseProvider _providerFor(
    MosaicPaywallDocument document,
    MosaicPreviewMockCommerceState state,
    MosaicLocalRevision? revision,
  ) {
    final key = Object.hash(document, state, revision);
    if (_providerKey != key) {
      _providerKey = key;
      _previewProvider = MosaicPreviewPurchaseProvider(
        document: document,
        state: state,
      );
    }
    return _previewProvider!;
  }

  void _reportWarning(
    MosaicDiagnostic diagnostic,
    MosaicLocalRevision? revision,
  ) {
    final key = '${revision?.revisionId}:${diagnostic.code}';
    if (!_reportedWarningKeys.add(key)) {
      return;
    }
    final selectorFallback = diagnostic.code.contains('product');
    widget.client.reportRenderWarning(
      MosaicPreviewCompatibilityWarning(
        code: 'preview.render.${diagnostic.code}',
        severity: MosaicPreviewCompatibilitySeverity.warning,
        message: diagnostic.message,
        location: const MosaicPreviewDiagnosticLocation(documentPath: ''),
        fallback: selectorFallback
            ? MosaicPreviewCompatibilityFallback.useSelectorFallback
            : MosaicPreviewCompatibilityFallback.nativeApproximation,
        recovery: MosaicPreviewRecovery(
          action: selectorFallback
              ? MosaicPreviewRecoveryAction.bindProduct
              : MosaicPreviewRecoveryAction.inspectComponent,
          message: selectorFallback
              ? 'Review the mock product binding in Studio.'
              : 'Inspect the affected component and its preview fallback.',
        ),
      ),
    );
  }
}
