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
    required this.fallbackPurchaseProvider,
    required this.onResult,
    this.fallbackDocument,
    this.showBundledFallback = true,
    this.imageResolver,
    this.videoResolver,
    this.onInteraction,
    this.onDiagnostic,
    super.key,
  });

  final MosaicPreviewClient client;
  final MosaicPaywallDocument? fallbackDocument;
  final bool showBundledFallback;
  final MosaicPurchaseProvider fallbackPurchaseProvider;
  final MosaicBundledImageResolver? imageResolver;
  final MosaicBundledVideoResolver? videoResolver;
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
        final liveDocument = widget.client.documentForRendering;
        final document = liveDocument ??
            (widget.showBundledFallback ? widget.fallbackDocument : null);
        if (document == null) {
          return _PreviewConnectionState(
            status: widget.client.connectionStatus,
            hasIssue: widget.client.draftIssue != null,
            onReconnect: widget.client.connect,
          );
        }
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
            videoResolver: widget.videoResolver,
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

final class _PreviewConnectionState extends StatelessWidget {
  const _PreviewConnectionState({
    required this.status,
    required this.hasIssue,
    required this.onReconnect,
  });

  final MosaicPreviewConnectionStatus status;
  final bool hasIssue;
  final Future<void> Function() onReconnect;

  @override
  Widget build(BuildContext context) {
    final loading = status != MosaicPreviewConnectionStatus.disconnected;
    final title = hasIssue
        ? 'Design unavailable'
        : switch (status) {
            MosaicPreviewConnectionStatus.connecting ||
            MosaicPreviewConnectionStatus.reconnecting =>
              'Connecting to Studio',
            MosaicPreviewConnectionStatus.connected =>
              'Waiting for your design',
            MosaicPreviewConnectionStatus.disconnected =>
              "Can't connect to Studio",
          };
    final message = hasIssue
        ? 'Studio sent a design this renderer could not display.'
        : switch (status) {
            MosaicPreviewConnectionStatus.connecting ||
            MosaicPreviewConnectionStatus.reconnecting =>
              'Keep Studio open while the preview connects.',
            MosaicPreviewConnectionStatus.connected =>
              'Connected. Send or edit a design in Studio to preview it here.',
            MosaicPreviewConnectionStatus.disconnected =>
              'Open Studio and confirm both apps use the same preview session.',
          };
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (loading)
              const CircularProgressIndicator()
            else
              Icon(
                Icons.wifi_off,
                size: 40,
                color: Theme.of(context).colorScheme.error,
              ),
            const SizedBox(height: 14),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            if (!loading) ...<Widget>[
              const SizedBox(height: 14),
              FilledButton.tonal(
                onPressed: onReconnect,
                child: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
