import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import 'commerce.dart';
import 'configuration.dart';
import 'localization.dart';
import 'presentation.dart';
import 'protocol.dart';

typedef MosaicBundledImageResolver = ImageProvider<Object>? Function(
  String logicalKey,
);

typedef MosaicClock = DateTime Function();

DateTime _mosaicSystemClock() => DateTime.now().toUtc();

/// Loads a local document atomically and renders it, falling back to the
/// host-supplied bundled document when the candidate is absent or rejected.
final class MosaicPaywallHost extends StatefulWidget {
  const MosaicPaywallHost({
    required this.mosaic,
    required this.bundledFallbackLoader,
    required this.onResult,
    this.candidateDocument,
    this.requestedLocale,
    this.imageResolver,
    this.onInteraction,
    this.onDiagnostic,
    this.loadingBuilder,
    super.key,
  });

  final Mosaic mosaic;
  final String? candidateDocument;
  final MosaicBundledDocumentLoader bundledFallbackLoader;
  final String? requestedLocale;
  final MosaicBundledImageResolver? imageResolver;
  final MosaicPresentationResultCallback onResult;
  final MosaicInteractionCallback? onInteraction;
  final MosaicDiagnosticCallback? onDiagnostic;
  final WidgetBuilder? loadingBuilder;

  @override
  State<MosaicPaywallHost> createState() => _MosaicPaywallHostState();
}

final class _MosaicPaywallHostState extends State<MosaicPaywallHost> {
  late Future<MosaicPaywallLoadResult> _load;
  MosaicPaywallLoadUnavailable? _reportedUnavailable;

  @override
  void initState() {
    super.initState();
    _beginLoad();
  }

  @override
  void didUpdateWidget(MosaicPaywallHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.candidateDocument != widget.candidateDocument ||
        oldWidget.bundledFallbackLoader != widget.bundledFallbackLoader) {
      _beginLoad();
    }
  }

  void _beginLoad() {
    _reportedUnavailable = null;
    _load = const MosaicPaywallLoader().load(
      candidateDocument: widget.candidateDocument,
      bundledFallbackLoader: widget.bundledFallbackLoader,
      onDiagnostic: widget.onDiagnostic,
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<MosaicPaywallLoadResult>(
      future: _load,
      builder: (context, snapshot) {
        final result = snapshot.data;
        if (result == null) {
          if (snapshot.hasError) {
            _reportUnexpectedHostFailure();
            return const SizedBox.shrink();
          }
          return widget.loadingBuilder?.call(context) ??
              const SizedBox.shrink();
        }
        return switch (result) {
          MosaicPaywallLoaded() => MosaicPaywall(
              key: ValueKey<String>(
                '${result.document.id}-${result.document.revision}-'
                '${result.source.name}',
              ),
              document: result.document,
              purchaseProvider: widget.mosaic.purchaseProvider,
              requestedLocale: widget.requestedLocale,
              imageResolver: widget.imageResolver,
              onResult: widget.onResult,
              onInteraction: widget.onInteraction,
              onDiagnostic: widget.onDiagnostic,
            ),
          MosaicPaywallLoadUnavailable() => _unavailable(result),
        };
      },
    );
  }

  Widget _unavailable(MosaicPaywallLoadUnavailable result) {
    if (!identical(_reportedUnavailable, result)) {
      _reportedUnavailable = result;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !identical(_reportedUnavailable, result)) {
          return;
        }
        widget.onResult(
          MosaicConfigurationUnavailablePresentationResult(
            diagnosticCode: result.diagnosticCode,
          ),
        );
      });
    }
    return const SizedBox.shrink();
  }

  void _reportUnexpectedHostFailure() {
    if (_reportedUnavailable != null) {
      return;
    }
    const result = MosaicPaywallLoadUnavailable(
      diagnosticCode: 'paywall_host_failed',
    );
    _reportedUnavailable = result;
    widget.onDiagnostic?.call(
      const MosaicDiagnostic(
        code: 'paywall_host_failed',
        message: 'The local paywall host could not prepare the renderer.',
        severity: MosaicDiagnosticSeverity.error,
      ),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && identical(_reportedUnavailable, result)) {
        widget.onResult(
          const MosaicRenderingFailedPresentationResult(
            diagnosticCode: 'paywall_host_failed',
          ),
        );
      }
    });
  }
}

/// Native Flutter renderer for a fully validated Protocol 0.1 document.
///
/// This embedded widget reports terminal results but never dismisses routes,
/// sheets, dialogs, or other host-owned presentation UI.
final class MosaicPaywall extends StatefulWidget {
  const MosaicPaywall({
    required this.document,
    required this.purchaseProvider,
    required this.onResult,
    this.requestedLocale,
    this.imageResolver,
    this.onInteraction,
    this.onDiagnostic,
    this.clock = _mosaicSystemClock,
    super.key,
  });

  final MosaicPaywallDocument document;
  final MosaicPurchaseProvider purchaseProvider;
  final String? requestedLocale;
  final MosaicBundledImageResolver? imageResolver;
  final MosaicPresentationResultCallback onResult;
  final MosaicInteractionCallback? onInteraction;
  final MosaicDiagnosticCallback? onDiagnostic;
  final MosaicClock clock;

  @override
  State<MosaicPaywall> createState() => _MosaicPaywallState();
}

final class _MosaicPaywallState extends State<MosaicPaywall> {
  final ScrollController _scrollController = ScrollController();
  final Map<String, MosaicProduct> _availableProducts =
      <String, MosaicProduct>{};
  final Map<String, String?> _selectedProductReferences = <String, String?>{};
  final Set<String> _notifiedUnavailableSelectors = <String>{};
  final Set<String> _notifiedHiddenPurchaseTargets = <String>{};
  final Map<String, bool> _switchValues = <String, bool>{};
  final Map<String, int> _carouselPages = <String, int>{};

  late MosaicResolvedLocalization _localization;
  bool _productsResolved = false;
  String? _busyActionId;
  int _loadGeneration = 0;
  Timer? _countdownTimer;

  @override
  void initState() {
    super.initState();
    _resolveLocalization();
    _resetRuntimeState();
    _configureCountdownTimer();
    unawaited(_loadProducts());
  }

  @override
  void didUpdateWidget(MosaicPaywall oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.document != widget.document ||
        oldWidget.requestedLocale != widget.requestedLocale) {
      _resolveLocalization();
    }
    if (oldWidget.document != widget.document) {
      _resetRuntimeState();
      _configureCountdownTimer();
    }
    if (oldWidget.document != widget.document ||
        oldWidget.purchaseProvider != widget.purchaseProvider) {
      _availableProducts.clear();
      _selectedProductReferences.clear();
      _notifiedUnavailableSelectors.clear();
      _productsResolved = false;
      unawaited(_loadProducts());
    }
  }

  @override
  void dispose() {
    _loadGeneration += 1;
    _countdownTimer?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  void _resolveLocalization() {
    _localization = const MosaicLocaleResolver().resolve(
      widget.document,
      requestedLocale: widget.requestedLocale,
    );
  }

  void _resetRuntimeState() {
    _switchValues
      ..clear()
      ..addEntries(
        widget.document.nodes.whereType<MosaicSwitchComponent>().map(
              (component) => MapEntry(component.id, component.initialValue),
            ),
      );
    _carouselPages
      ..clear()
      ..addEntries(
        widget.document.nodes.whereType<MosaicCarouselComponent>().map(
              (component) => MapEntry(component.id, component.initialPageIndex),
            ),
      );
    _notifiedHiddenPurchaseTargets.clear();
  }

  void _configureCountdownTimer() {
    _countdownTimer?.cancel();
    if (widget.document.nodes.any((node) => node is MosaicCountdownComponent)) {
      _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    }
  }

  Future<void> _loadProducts() async {
    final generation = ++_loadGeneration;
    final requestedIds = widget.document.products
        .map((reference) => reference.productId)
        .toList(growable: false);

    var available = <String, MosaicProduct>{};
    try {
      if (requestedIds.isEmpty) {
        available = <String, MosaicProduct>{};
      } else {
        final result = await widget.purchaseProvider.loadProducts(requestedIds);
        available = switch (result) {
          MosaicProductsLoaded() => <String, MosaicProduct>{
              for (final product in result.products)
                if (requestedIds.contains(product.id)) product.id: product,
            },
          MosaicProductsUnavailable() => <String, MosaicProduct>{},
        };
      }
    } on Object {
      if (!mounted || generation != _loadGeneration) {
        return;
      }
      widget.onDiagnostic?.call(
        const MosaicDiagnostic(
          code: 'product_provider_load_failed',
          message:
              'The purchase provider failed while loading products; the unavailable-product fallback is active.',
          severity: MosaicDiagnosticSeverity.warning,
        ),
      );
      available = <String, MosaicProduct>{};
    }

    if (!mounted || generation != _loadGeneration) {
      return;
    }
    setState(() {
      _availableProducts
        ..clear()
        ..addAll(available);
      _productsResolved = true;
      for (final selector in widget.document.nodes
          .whereType<MosaicProductSelectorComponent>()) {
        final availableReferences = _availableReferences(selector);
        final initial = selector.initiallySelectedProductReferenceId;
        _selectedProductReferences[selector.id] =
            availableReferences.any((reference) => reference.id == initial)
                ? initial
                : availableReferences.firstOrNull?.id;
      }
    });

    for (final selector
        in widget.document.nodes.whereType<MosaicProductSelectorComponent>()) {
      if (_selectedProductReferences[selector.id] == null) {
        _notifyUnavailableSelector(selector);
      }
    }
  }

  List<MosaicProductReference> _availableReferences(
    MosaicProductSelectorComponent selector,
  ) {
    return <MosaicProductReference>[
      for (final referenceId in selector.productReferenceIds)
        if (widget.document.productReference(referenceId) case final reference?)
          if (_availableProducts.containsKey(reference.productId)) reference,
    ];
  }

  void _notifyUnavailableSelector(MosaicProductSelectorComponent selector) {
    if (!_notifiedUnavailableSelectors.add(selector.id)) {
      return;
    }
    _notifyProductUnavailable(
      selector.id,
      referenceId: selector.initiallySelectedProductReferenceId,
      reportPresentationResult: false,
    );
  }

  void _notifyProductUnavailable(
    String selectorId, {
    String? referenceId,
    bool reportPresentationResult = true,
  }) {
    widget.onInteraction?.call(
      MosaicInteraction(
        outcome: MosaicInteractionOutcome.productUnavailable,
        productReferenceId: referenceId,
        productSelectorId: selectorId,
      ),
    );
    if (reportPresentationResult) {
      widget.onResult(
        MosaicProductUnavailablePresentationResult(
          productReferenceId: referenceId,
          productSelectorId: selectorId,
        ),
      );
    }
  }

  void _selectProduct(String selectorId, String productReferenceId) {
    if (_busyActionId != null ||
        _selectedProductReferences[selectorId] == productReferenceId) {
      return;
    }
    setState(() {
      _selectedProductReferences[selectorId] = productReferenceId;
    });
    widget.onInteraction?.call(
      MosaicInteraction(
        outcome: MosaicInteractionOutcome.productSelected,
        productReferenceId: productReferenceId,
        productSelectorId: selectorId,
      ),
    );
  }

  Future<void> _purchase(MosaicPurchaseButtonComponent button) async {
    if (_busyActionId != null) {
      return;
    }
    final selectorId = button.action.productSelectorId;
    final selector = widget.document.nodes
        .whereType<MosaicProductSelectorComponent>()
        .firstWhere((candidate) => candidate.id == selectorId);
    final referenceId = _selectedProductReferences[selectorId];
    if (referenceId == null) {
      _notifyProductUnavailable(
        selectorId,
        referenceId: selector.initiallySelectedProductReferenceId,
      );
      return;
    }
    final reference = widget.document.productReference(referenceId)!;
    setState(() {
      _busyActionId = button.id;
    });

    try {
      final result =
          await widget.purchaseProvider.purchase(reference.productId);
      if (!mounted) {
        return;
      }
      switch (result) {
        case MosaicPurchased():
          widget.onInteraction?.call(
            MosaicInteraction(
              outcome: MosaicInteractionOutcome.purchased,
              productReferenceId: referenceId,
              productSelectorId: selectorId,
            ),
          );
          widget.onResult(
            MosaicPurchasedPresentationResult(
              productReferenceId: referenceId,
            ),
          );
        case MosaicAlreadyEntitled():
          widget.onInteraction?.call(
            MosaicInteraction(
              outcome: MosaicInteractionOutcome.alreadyEntitled,
              productReferenceId: referenceId,
              productSelectorId: selectorId,
            ),
          );
          widget.onResult(
            MosaicAlreadyEntitledPresentationResult(<String>{referenceId}),
          );
        case MosaicPurchaseCancelled():
          widget.onInteraction?.call(
            MosaicInteraction(
              outcome: MosaicInteractionOutcome.cancelled,
              productReferenceId: referenceId,
              productSelectorId: selectorId,
            ),
          );
          widget.onResult(
            MosaicCancelledPresentationResult(
              productReferenceId: referenceId,
            ),
          );
        case MosaicPurchaseProductUnavailable():
          _notifyProductUnavailable(selectorId, referenceId: referenceId);
        case MosaicPurchaseFailed():
          _reportPurchaseFailure(
            selectorId: selectorId,
            referenceId: referenceId,
            diagnosticCode: 'purchase_provider_failed',
          );
      }
    } on Object {
      if (mounted) {
        _reportPurchaseFailure(
          selectorId: selectorId,
          referenceId: referenceId,
          diagnosticCode: 'purchase_provider_exception',
        );
      }
    } finally {
      if (mounted && _busyActionId == button.id) {
        setState(() {
          _busyActionId = null;
        });
      }
    }
  }

  void _reportPurchaseFailure({
    required String selectorId,
    required String referenceId,
    required String diagnosticCode,
  }) {
    widget.onDiagnostic?.call(
      MosaicDiagnostic(
        code: diagnosticCode,
        message: 'The purchase provider could not complete the purchase.',
        severity: MosaicDiagnosticSeverity.error,
      ),
    );
    widget.onInteraction?.call(
      MosaicInteraction(
        outcome: MosaicInteractionOutcome.purchaseFailed,
        productReferenceId: referenceId,
        productSelectorId: selectorId,
        diagnosticCode: diagnosticCode,
      ),
    );
    widget.onResult(
      MosaicPurchaseFailedPresentationResult(
        productReferenceId: referenceId,
        diagnosticCode: diagnosticCode,
      ),
    );
  }

  Future<void> _restore(MosaicRestoreButtonComponent button) async {
    if (_busyActionId != null) {
      return;
    }
    setState(() {
      _busyActionId = button.id;
    });
    try {
      final result = await widget.purchaseProvider.restore();
      if (!mounted) {
        return;
      }
      switch (result) {
        case MosaicRestored():
          final references = _referenceIds(result.entitlements);
          widget.onInteraction?.call(
            const MosaicInteraction(
              outcome: MosaicInteractionOutcome.restored,
            ),
          );
          widget.onResult(MosaicRestoredPresentationResult(references));
        case MosaicRestoreAlreadyEntitled():
          final references = _referenceIds(result.entitlements);
          widget.onInteraction?.call(
            const MosaicInteraction(
              outcome: MosaicInteractionOutcome.alreadyEntitled,
            ),
          );
          widget.onResult(
            MosaicAlreadyEntitledPresentationResult(references),
          );
        case MosaicNothingToRestore():
          widget.onInteraction?.call(
            const MosaicInteraction(
              outcome: MosaicInteractionOutcome.restoreNoPurchases,
            ),
          );
        case MosaicRestoreFailed():
          _reportRestoreFailure('restore_provider_failed');
      }
    } on Object {
      if (mounted) {
        _reportRestoreFailure('restore_provider_exception');
      }
    } finally {
      if (mounted && _busyActionId == button.id) {
        setState(() {
          _busyActionId = null;
        });
      }
    }
  }

  Set<String> _referenceIds(Set<MosaicEntitlement> entitlements) {
    final providerIds =
        entitlements.map((entitlement) => entitlement.id).toSet();
    return <String>{
      for (final reference in widget.document.products)
        if (providerIds.contains(reference.productId)) reference.id,
    };
  }

  void _reportRestoreFailure(String diagnosticCode) {
    widget.onDiagnostic?.call(
      MosaicDiagnostic(
        code: diagnosticCode,
        message: 'The purchase provider could not complete the restore.',
        severity: MosaicDiagnosticSeverity.error,
      ),
    );
    widget.onInteraction?.call(
      MosaicInteraction(
        outcome: MosaicInteractionOutcome.restoreFailed,
        diagnosticCode: diagnosticCode,
      ),
    );
  }

  void _close() {
    widget.onInteraction?.call(
      const MosaicInteraction(outcome: MosaicInteractionOutcome.dismissed),
    );
    widget.onResult(const MosaicDismissedPresentationResult());
  }

  @override
  Widget build(BuildContext context) {
    Widget content = _buildNode(context, widget.document.layout.content);
    if (widget.document.layout.background case final background?) {
      content = ColoredBox(
        color: _color(context, background),
        child: content,
      );
    }
    final scrollView = SingleChildScrollView(
      key: const ValueKey<String>('mosaic-paywall-scroll'),
      controller: _scrollController,
      child: content,
    );
    final scrollable = widget.document.layout.showsIndicators
        ? Scrollbar(
            controller: _scrollController,
            thumbVisibility: true,
            child: scrollView,
          )
        : scrollView;
    return Directionality(
      textDirection: _localization.textDirection,
      child: Material(
        type: MaterialType.transparency,
        child: SafeArea(child: scrollable),
      ),
    );
  }

  Widget _buildStack(BuildContext context, MosaicStackNode stack) {
    final children = <Widget>[];
    for (var index = 0; index < stack.children.length; index += 1) {
      if (index > 0 && stack.spacing > 0) {
        children.add(
          stack is MosaicStackComponent &&
                  stack.direction == MosaicStackDirection.horizontal
              ? SizedBox(width: stack.spacing)
              : SizedBox(height: stack.spacing),
        );
      }
      final child = _buildNode(context, stack.children[index]);
      children.add(
        stack is MosaicStackComponent &&
                stack.direction == MosaicStackDirection.horizontal
            ? Flexible(child: child)
            : child,
      );
    }
    final Widget stackWidget;
    if (stack is MosaicStackComponent &&
        stack.direction == MosaicStackDirection.horizontal) {
      final row = Row(
        mainAxisSize: stack.sizing?.width?.mode == MosaicSizingMode.fill
            ? MainAxisSize.max
            : MainAxisSize.min,
        mainAxisAlignment: _mainAxisAlignment(stack.mainAxisDistribution),
        crossAxisAlignment: _crossAxisAlignment(stack.crossAxisAlignment),
        children: children,
      );
      stackWidget =
          stack.crossAxisAlignment == MosaicStackHorizontalAlignment.stretch
              ? IntrinsicHeight(child: row)
              : row;
    } else {
      final alignment = stack is MosaicStackComponent
          ? stack.crossAxisAlignment
          : (stack as MosaicVerticalStack).horizontalAlignment;
      stackWidget = Column(
        mainAxisSize: stack is MosaicStackComponent &&
                stack.sizing?.height?.mode == MosaicSizingMode.fixed
            ? MainAxisSize.max
            : MainAxisSize.min,
        mainAxisAlignment: stack is MosaicStackComponent
            ? _mainAxisAlignment(stack.mainAxisDistribution)
            : MainAxisAlignment.start,
        crossAxisAlignment: _crossAxisAlignment(alignment),
        children: children,
      );
    }
    final padded = Padding(
      key: ValueKey<String>('mosaic-${stack.id}'),
      padding: EdgeInsetsDirectional.fromSTEB(
        stack.padding.start,
        stack.padding.top,
        stack.padding.end,
        stack.padding.bottom,
      ),
      child: stackWidget,
    );
    return stack is MosaicStackComponent
        ? _decorateNode(
            context,
            stack,
            padded,
            appearance: stack.appearance,
            sizing: stack.sizing,
            outerInsets: stack.outerInsets,
            visibility: stack.visibility,
          )
        : padded;
  }

  Widget _buildNode(BuildContext context, MosaicNode node) {
    final content = switch (node) {
      MosaicVerticalStack() => _buildStack(context, node),
      MosaicStackComponent() => _buildStack(context, node),
      MosaicTextComponent() => _buildText(context, node),
      MosaicImageComponent() => _buildImage(context, node),
      MosaicFeatureListComponent() => _buildFeatureList(context, node),
      MosaicProductSelectorComponent() => _buildProductSelector(context, node),
      MosaicPurchaseButtonComponent() => _buildPurchaseButton(context, node),
      MosaicRestoreButtonComponent() => _buildRestoreButton(context, node),
      MosaicCloseButtonComponent() => _buildCloseButton(context, node),
      MosaicLegalTextComponent() => _buildLegalText(context, node),
      MosaicCarouselComponent() => _buildCarousel(context, node),
      MosaicSwitchComponent() => _buildSwitch(context, node),
      MosaicCountdownComponent() => _buildCountdown(context, node),
      MosaicScrollContainer() => const SizedBox.shrink(),
    };
    if (node is MosaicStackNode || node is MosaicScrollContainer) {
      return content;
    }
    return switch (node) {
      MosaicTextComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicImageComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: MosaicSizing(width: node.width),
          outerInsets: node.outerInsets,
          visibility: node.visibility,
          forceClip: (node.appearance?.cornerRadius ?? 0) > 0,
        ),
      MosaicFeatureListComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicProductSelectorComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicPurchaseButtonComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicRestoreButtonComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicCloseButtonComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicLegalTextComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicCarouselComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicSwitchComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicCountdownComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      _ => content,
    };
  }

  Widget _buildText(BuildContext context, MosaicTextComponent component) {
    final value = _localization.text(component.value);
    final style = _textStyle(context, component.typography, component.style);
    final accessibilityLabel = component.accessibility.label == null
        ? value
        : _localization.text(component.accessibility.label!);
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      label: accessibilityLabel,
      header:
          component.accessibility.role == MosaicTextAccessibilityRole.heading,
      child: ExcludeSemantics(
        child: Text(
          value,
          style: style,
          textAlign: _textAlign(component.alignment),
          maxLines: component.typography?.maxLines,
          overflow: switch (component.typography?.overflow) {
            MosaicTextOverflow.ellipsis => TextOverflow.ellipsis,
            MosaicTextOverflow.clip => TextOverflow.clip,
            null => null,
          },
        ),
      ),
    );
  }

  Widget _buildImage(BuildContext context, MosaicImageComponent component) {
    final asset = widget.document.imageAsset(component.assetId)!;
    final placeholder = _imagePlaceholder(context, asset);
    ImageProvider<Object>? provider;
    try {
      provider = widget.imageResolver?.call(asset.sourceKey);
    } on Object {
      provider = null;
    }
    final content = provider == null
        ? placeholder
        : Image(
            image: provider,
            fit: component.contentMode == MosaicImageContentMode.fit
                ? BoxFit.contain
                : BoxFit.cover,
            errorBuilder: (context, error, stackTrace) => placeholder,
          );
    final aspectRatio = component.aspectRatio;
    final Widget frame = aspectRatio != null
        ? AspectRatio(
            aspectRatio: aspectRatio,
            child: ClipRect(child: content),
          )
        : SizedBox(
            height: component.fixedHeight,
            child: ClipRect(child: content),
          );
    if (component.accessibility.hidden) {
      return ExcludeSemantics(
        key: ValueKey<String>('mosaic-${component.id}'),
        child: frame,
      );
    }
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      image: true,
      label: _localization.text(component.accessibility.label!),
      child: ExcludeSemantics(child: frame),
    );
  }

  Widget _imagePlaceholder(BuildContext context, MosaicImageAsset asset) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            _localization.text(asset.placeholder),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ),
    );
  }

  Widget _buildFeatureList(
    BuildContext context,
    MosaicFeatureListComponent component,
  ) {
    final children = <Widget>[];
    for (var index = 0; index < component.items.length; index += 1) {
      if (index > 0 && component.itemSpacing > 0) {
        children.add(SizedBox(height: component.itemSpacing));
      }
      final item = component.items[index];
      children.add(
        Row(
          key: ValueKey<String>('mosaic-${component.id}-${item.id}'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            ExcludeSemantics(
              child: Icon(
                Icons.check_circle,
                size: 20,
                color: component.markerColor == null
                    ? Theme.of(context).colorScheme.primary
                    : _color(context, component.markerColor!),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                _localization.text(item.text),
                style: component.typography == null
                    ? null
                    : _textStyle(
                        context,
                        component.typography,
                        component.typography!.style,
                      ),
                textAlign: component.typography == null
                    ? null
                    : _textAlign(component.typography!.alignment),
              ),
            ),
          ],
        ),
      );
    }
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      container: true,
      explicitChildNodes: true,
      label: _localization.text(component.accessibility.label),
      hint: component.accessibility.hint == null
          ? null
          : _localization.text(component.accessibility.hint!),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: children,
      ),
    );
  }

  Widget _buildProductSelector(
    BuildContext context,
    MosaicProductSelectorComponent component,
  ) {
    final Widget content;
    if (!_productsResolved) {
      content = const Center(
        child: SizedBox.square(
          dimension: 28,
          child: CircularProgressIndicator(),
        ),
      );
    } else {
      final references = _availableReferences(component);
      if (references.isEmpty) {
        final message =
            _localization.text(component.unavailableFallback.message);
        content = Semantics(
          key: ValueKey<String>('mosaic-${component.id}-unavailable'),
          liveRegion: true,
          label: message,
          child: ExcludeSemantics(child: Text(message)),
        );
      } else {
        final options = <Widget>[];
        for (var index = 0; index < references.length; index += 1) {
          if (index > 0 && component.itemSpacing > 0) {
            options.add(
              component.direction == MosaicProductSelectorDirection.vertical
                  ? SizedBox(height: component.itemSpacing)
                  : SizedBox(width: component.itemSpacing),
            );
          }
          final option =
              _buildProductOption(context, component, references[index]);
          options.add(
            component.direction == MosaicProductSelectorDirection.horizontal
                ? Expanded(child: option)
                : option,
          );
        }
        content = component.direction == MosaicProductSelectorDirection.vertical
            ? Column(mainAxisSize: MainAxisSize.min, children: options)
            : Row(mainAxisSize: MainAxisSize.max, children: options);
      }
    }

    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      container: true,
      explicitChildNodes: true,
      label: _localization.text(component.accessibility.label),
      hint: component.accessibility.hint == null
          ? null
          : _localization.text(component.accessibility.hint!),
      child: content,
    );
  }

  Widget _buildProductOption(
    BuildContext context,
    MosaicProductSelectorComponent selector,
    MosaicProductReference reference,
  ) {
    final product = _availableProducts[reference.productId]!;
    final selected = _selectedProductReferences[selector.id] == reference.id;
    final enabled = _busyActionId == null;
    final label = <String>[
      _localization.text(reference.label),
      if (reference.badge case final badge?) _localization.text(badge),
      product.localizedPrice,
      if (product.localizedPeriod case final period?) period,
    ].join(', ');
    final colorScheme = Theme.of(context).colorScheme;
    final authoredStyle = selector.cardStyles?.resolve(selected: selected);
    return Semantics(
      key: ValueKey<String>('mosaic-${selector.id}-${reference.id}'),
      button: true,
      selected: selected,
      enabled: enabled,
      label: label,
      child: ExcludeSemantics(
        child: Material(
          color: authoredStyle == null
              ? selected
                  ? colorScheme.primaryContainer
                  : colorScheme.surfaceContainerLow
              : _color(context, authoredStyle.background),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(
              authoredStyle?.cornerRadius ?? 12,
            ),
            side: BorderSide(
              color: authoredStyle == null
                  ? selected
                      ? colorScheme.primary
                      : colorScheme.outlineVariant
                  : _color(context, authoredStyle.border.color),
              width: authoredStyle?.border.width ?? (selected ? 2 : 1),
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: enabled
                ? () => _selectProduct(selector.id, reference.id)
                : null,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 56),
              child: Padding(
                padding: authoredStyle == null
                    ? const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 12)
                    : _edgeInsets(authoredStyle.padding),
                child: Row(
                  children: <Widget>[
                    Icon(
                      selected
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                      color:
                          selected ? colorScheme.primary : colorScheme.outline,
                    ),
                    SizedBox(width: authoredStyle?.contentGap ?? 12),
                    Expanded(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            _localization.text(reference.label),
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(
                                  color: authoredStyle == null
                                      ? null
                                      : _color(
                                          context,
                                          authoredStyle.productLabelColor,
                                        ),
                                ),
                          ),
                          if (reference.badge case final badge?)
                            Container(
                              padding: authoredStyle == null
                                  ? null
                                  : _edgeInsets(authoredStyle.badge.padding),
                              decoration: authoredStyle == null
                                  ? null
                                  : BoxDecoration(
                                      color: _color(
                                        context,
                                        authoredStyle.badge.background,
                                      ),
                                      border: Border.all(
                                        color: _color(
                                          context,
                                          authoredStyle.badge.border.color,
                                        ),
                                        width: authoredStyle.badge.border.width,
                                        strokeAlign:
                                            BorderSide.strokeAlignInside,
                                      ),
                                      borderRadius: BorderRadius.circular(
                                        authoredStyle.badge.cornerRadius,
                                      ),
                                    ),
                              child: Text(
                                _localization.text(badge),
                                style: Theme.of(context)
                                    .textTheme
                                    .labelMedium
                                    ?.copyWith(
                                      color: authoredStyle == null
                                          ? null
                                          : _color(
                                              context,
                                              authoredStyle.badge.textColor,
                                            ),
                                    ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    SizedBox(width: authoredStyle?.contentGap ?? 12),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        Text(
                          product.localizedPrice,
                          style:
                              Theme.of(context).textTheme.titleMedium?.copyWith(
                                    color: authoredStyle == null
                                        ? null
                                        : _color(
                                            context,
                                            authoredStyle.runtimePriceColor,
                                          ),
                                  ),
                        ),
                        if (product.localizedPeriod case final period?)
                          Text(
                            period,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPurchaseButton(
    BuildContext context,
    MosaicPurchaseButtonComponent component,
  ) {
    final busy = _busyActionId == component.id;
    final selected =
        _selectedProductReferences[component.action.productSelectorId];
    final targetVisible =
        _isNodeEffectivelyVisible(component.action.productSelectorId);
    if (!targetVisible &&
        _notifiedHiddenPurchaseTargets
            .add(component.action.productSelectorId)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted &&
            !_isNodeEffectivelyVisible(component.action.productSelectorId)) {
          widget.onDiagnostic?.call(
            const MosaicDiagnostic(
              code: 'purchase.hiddenProductSelector',
              message:
                  'Purchase is disabled because its Product Selector is hidden.',
              severity: MosaicDiagnosticSeverity.warning,
            ),
          );
        }
      });
    } else if (targetVisible) {
      _notifiedHiddenPurchaseTargets.remove(
        component.action.productSelectorId,
      );
    }
    final enabled = _productsResolved &&
        selected != null &&
        _busyActionId == null &&
        targetVisible;
    final visibleLabel = _localization.text(
      busy ? component.inProgressLabel : component.label,
    );
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      button: true,
      enabled: enabled,
      liveRegion: busy,
      label: _localization.text(component.accessibility.label),
      hint: component.accessibility.hint == null
          ? null
          : _localization.text(component.accessibility.hint!),
      value: busy ? visibleLabel : null,
      child: ExcludeSemantics(
        child: component.typography == null
            ? FilledButton(
                onPressed:
                    enabled ? () => unawaited(_purchase(component)) : null,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(48, 48),
                ),
                child: Text(visibleLabel),
              )
            : TextButton(
                onPressed:
                    enabled ? () => unawaited(_purchase(component)) : null,
                style: TextButton.styleFrom(
                  minimumSize: const Size(48, 48),
                  foregroundColor: _color(context, component.typography!.color),
                  textStyle: _textStyle(
                    context,
                    component.typography,
                    component.typography!.style,
                  ),
                ),
                child: Text(visibleLabel),
              ),
      ),
    );
  }

  Widget _buildRestoreButton(
    BuildContext context,
    MosaicRestoreButtonComponent component,
  ) {
    final busy = _busyActionId == component.id;
    final enabled = _busyActionId == null;
    final visibleLabel = _localization.text(
      busy ? component.inProgressLabel : component.label,
    );
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      button: true,
      enabled: enabled,
      liveRegion: busy,
      label: _localization.text(component.accessibility.label),
      hint: component.accessibility.hint == null
          ? null
          : _localization.text(component.accessibility.hint!),
      value: busy ? visibleLabel : null,
      child: ExcludeSemantics(
        child: component.typography == null
            ? OutlinedButton(
                onPressed:
                    enabled ? () => unawaited(_restore(component)) : null,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(48, 48),
                ),
                child: Text(visibleLabel),
              )
            : TextButton(
                onPressed:
                    enabled ? () => unawaited(_restore(component)) : null,
                style: TextButton.styleFrom(
                  minimumSize: const Size(48, 48),
                  foregroundColor: _color(context, component.typography!.color),
                  textStyle: _textStyle(
                    context,
                    component.typography,
                    component.typography!.style,
                  ),
                ),
                child: Text(visibleLabel),
              ),
      ),
    );
  }

  Widget _buildCloseButton(
    BuildContext context,
    MosaicCloseButtonComponent component,
  ) {
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      button: true,
      enabled: true,
      label: _localization.text(component.accessibility.label),
      hint: component.accessibility.hint == null
          ? null
          : _localization.text(component.accessibility.hint!),
      child: ExcludeSemantics(
        child: TextButton(
          onPressed: _close,
          style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
          child: Text(
            _localization.text(component.label),
            style: component.typography == null
                ? null
                : _textStyle(
                    context,
                    component.typography,
                    component.typography!.style,
                  ),
          ),
        ),
      ),
    );
  }

  Widget _buildLegalText(
    BuildContext context,
    MosaicLegalTextComponent component,
  ) {
    final value = _localization.text(component.value);
    final accessibilityLabel = component.accessibility.label == null
        ? value
        : _localization.text(component.accessibility.label!);
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      label: accessibilityLabel,
      header:
          component.accessibility.role == MosaicTextAccessibilityRole.heading,
      child: ExcludeSemantics(
        child: Text(
          value,
          style: component.typography == null
              ? Theme.of(context).textTheme.bodySmall
              : _textStyle(
                  context,
                  component.typography,
                  component.typography!.style,
                ),
          textAlign: _textAlign(component.alignment),
        ),
      ),
    );
  }

  Widget _buildCarousel(
    BuildContext context,
    MosaicCarouselComponent component,
  ) {
    return MosaicCarouselViewport(
      resetToken: Object.hash(
        widget.document,
        widget.requestedLocale,
        MediaQuery.textScalerOf(context),
      ),
      initialPageIndex:
          _carouselPages[component.id] ?? component.initialPageIndex,
      pages: <Widget>[
        for (final page in component.pages) _buildStack(context, page.content),
      ],
      pageLabels: <String>[
        for (final page in component.pages)
          _localization.text(page.accessibilityLabel),
      ],
      label: _localization.text(component.accessibility.label),
      hint: component.accessibility.hint == null
          ? null
          : _localization.text(component.accessibility.hint!),
      showsIndicators: component.showsIndicators,
      textDirection: _localization.textDirection,
      onPageChanged: (page) {
        if (!mounted) return;
        setState(() {
          _carouselPages[component.id] = page;
        });
      },
    );
  }

  Widget _buildSwitch(
    BuildContext context,
    MosaicSwitchComponent component,
  ) {
    final value = _switchValues[component.id] ?? component.initialValue;
    final label = _localization.text(component.label);
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      label: _localization.text(component.accessibility.label),
      hint: component.accessibility.hint == null
          ? null
          : _localization.text(component.accessibility.hint!),
      toggled: value,
      enabled: true,
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Expanded(
              child: Text(
                label,
                style: _textStyle(
                  context,
                  component.typography,
                  component.typography.style,
                ),
                textAlign: _textAlign(component.typography.alignment),
              ),
            ),
            const SizedBox(width: 12),
            Switch(
              value: value,
              thumbColor: WidgetStatePropertyAll<Color>(
                _color(context, component.thumbColor),
              ),
              trackColor: WidgetStateProperty.resolveWith<Color>((states) {
                return _color(
                  context,
                  states.contains(WidgetState.selected)
                      ? component.onTrackColor
                      : component.offTrackColor,
                );
              }),
              onChanged: (next) {
                setState(() {
                  _switchValues[component.id] = next;
                });
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCountdown(
    BuildContext context,
    MosaicCountdownComponent component,
  ) {
    final remaining = component.endsAt.difference(widget.clock().toUtc());
    final completed = remaining <= Duration.zero;
    final visible = completed
        ? _localization.text(component.completedText)
        : _formatCountdown(component, remaining);
    final accessibleOverride = component.accessibility.label;
    final accessible = accessibleOverride == null
        ? visible
        : completed
            ? '${_localization.text(accessibleOverride)}. '
                '${_localization.text(component.completedText)}'
            : '${_localization.text(accessibleOverride)}. $visible';
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      label: accessible,
      header:
          component.accessibility.role == MosaicTextAccessibilityRole.heading,
      // Countdown deliberately is not a live region; focus reads the current
      // summary and normal semantics updates expose completion once.
      liveRegion: false,
      child: ExcludeSemantics(
        child: Text(
          visible,
          style: _textStyle(
            context,
            component.typography,
            component.typography.style,
          ),
          textAlign: _textAlign(component.typography.alignment),
        ),
      ),
    );
  }

  String _formatCountdown(
    MosaicCountdownComponent component,
    Duration remaining,
  ) {
    var seconds = remaining.inSeconds;
    if (remaining.inMicroseconds % Duration.microsecondsPerSecond != 0) {
      seconds += 1;
    }
    final values = <MosaicCountdownUnit, int>{
      MosaicCountdownUnit.day: seconds ~/ Duration.secondsPerDay,
    };
    seconds %= Duration.secondsPerDay;
    values[MosaicCountdownUnit.hour] = seconds ~/ Duration.secondsPerHour;
    seconds %= Duration.secondsPerHour;
    values[MosaicCountdownUnit.minute] = seconds ~/ Duration.secondsPerMinute;
    values[MosaicCountdownUnit.second] = seconds % Duration.secondsPerMinute;
    const symbols = <MosaicCountdownUnit, String>{
      MosaicCountdownUnit.day: 'd',
      MosaicCountdownUnit.hour: 'h',
      MosaicCountdownUnit.minute: 'm',
      MosaicCountdownUnit.second: 's',
    };
    return <String>[
      for (var index = component.largestUnit.index;
          index <= component.smallestUnit.index;
          index += 1)
        '${values[MosaicCountdownUnit.values[index]]}'
            '${symbols[MosaicCountdownUnit.values[index]]}',
    ].join(' ');
  }

  Widget _decorateNode(
    BuildContext context,
    MosaicNode node,
    Widget child, {
    MosaicBoxAppearance? appearance,
    MosaicSizing? sizing,
    MosaicEdgeInsets? outerInsets,
    required MosaicVisibility visibility,
    bool forceClip = false,
  }) {
    Widget result = child;
    final radius = appearance?.cornerRadius ?? 0;
    if (appearance?.padding case final padding?) {
      result = Padding(padding: _edgeInsets(padding), child: result);
    }
    final shouldClip = forceClip || (appearance?.clipContent ?? false);
    if (shouldClip) {
      result = ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: result,
      );
    }
    if (appearance != null) {
      result = DecoratedBox(
        decoration: BoxDecoration(
          color: appearance.background == null
              ? null
              : _color(context, appearance.background!),
          border: appearance.border == null
              ? null
              : Border.all(
                  color: _color(context, appearance.border!.color),
                  width: appearance.border!.width,
                  strokeAlign: BorderSide.strokeAlignInside,
                ),
          borderRadius: radius == 0 ? null : BorderRadius.circular(radius),
        ),
        child: result,
      );
      if ((appearance.opacity ?? 1) != 1) {
        result = Opacity(
          opacity: appearance.opacity ?? 1,
          alwaysIncludeSemantics: true,
          child: result,
        );
      }
    }
    if (sizing != null) {
      final width = sizing.width?.mode == MosaicSizingMode.fixed
          ? sizing.width!.value
          : sizing.width?.mode == MosaicSizingMode.fill
              ? double.infinity
              : null;
      final height = sizing.height?.mode == MosaicSizingMode.fixed
          ? sizing.height!.value
          : null;
      if (width != null || height != null) {
        result = SizedBox(width: width, height: height, child: result);
      }
    }
    if (outerInsets != null) {
      result = Padding(padding: _edgeInsets(outerInsets), child: result);
    }
    return Visibility(
      key: ValueKey<String>('mosaic-visibility-${node.id}'),
      visible: _visibilityIsVisible(visibility),
      maintainState: true,
      maintainAnimation: true,
      child: result,
    );
  }

  bool _visibilityIsVisible(MosaicVisibility visibility) =>
      switch (visibility) {
        MosaicAlwaysVisible() => true,
        MosaicStaticallyHidden() => false,
        MosaicSwitchVisibility() =>
          _switchValues[visibility.switchId] == visibility.equals,
      };

  bool _isNodeEffectivelyVisible(String targetId) {
    bool? visit(MosaicNode node, bool ancestorsVisible) {
      final nodeVisible = ancestorsVisible &&
          _visibilityIsVisible(switch (node) {
            MosaicStackComponent() => node.visibility,
            MosaicTextComponent() => node.visibility,
            MosaicImageComponent() => node.visibility,
            MosaicFeatureListComponent() => node.visibility,
            MosaicProductSelectorComponent() => node.visibility,
            MosaicPurchaseButtonComponent() => node.visibility,
            MosaicRestoreButtonComponent() => node.visibility,
            MosaicCloseButtonComponent() => node.visibility,
            MosaicLegalTextComponent() => node.visibility,
            MosaicCarouselComponent() => node.visibility,
            MosaicSwitchComponent() => node.visibility,
            MosaicCountdownComponent() => node.visibility,
            _ => const MosaicAlwaysVisible(),
          });
      if (node.id == targetId) return nodeVisible;
      if (node is MosaicStackNode) {
        for (final child in node.children) {
          final result = visit(child, nodeVisible);
          if (result != null) return result;
        }
      } else if (node is MosaicCarouselComponent) {
        for (final page in node.pages) {
          final result = visit(page.content, nodeVisible);
          if (result != null) return result;
        }
      }
      return null;
    }

    return visit(widget.document.layout.content, true) ?? false;
  }

  TextStyle? _textStyle(
    BuildContext context,
    MosaicTypography? typography,
    MosaicTextStyle fallback,
  ) {
    final theme = Theme.of(context).textTheme;
    final base = switch (fallback) {
      MosaicTextStyle.display => theme.displaySmall,
      MosaicTextStyle.title => theme.headlineMedium,
      MosaicTextStyle.heading => theme.headlineSmall,
      MosaicTextStyle.body => theme.bodyLarge,
      MosaicTextStyle.label => theme.labelLarge,
      MosaicTextStyle.caption => theme.bodySmall,
    };
    if (typography == null) return base;
    return base?.copyWith(
      fontSize: typography.fontSize,
      height: typography.lineHeightMultiplier,
      fontWeight: switch (typography.weight) {
        MosaicFontWeight.regular => FontWeight.w400,
        MosaicFontWeight.medium => FontWeight.w500,
        MosaicFontWeight.semibold => FontWeight.w600,
        MosaicFontWeight.bold => FontWeight.w700,
      },
      color: _color(context, typography.color),
    );
  }

  Color _color(BuildContext context, MosaicColorValue value) {
    if (value.isLiteral) {
      final rgb = value.value.substring(1, 7);
      final alpha = value.value.substring(7, 9);
      return Color(int.parse('$alpha$rgb', radix: 16));
    }
    final colors = Theme.of(context).colorScheme;
    return switch (value.value) {
      'text.primary' => colors.onSurface,
      'text.secondary' => colors.onSurfaceVariant,
      'surface.default' => colors.surface,
      'surface.elevated' => colors.surfaceContainer,
      'action.primary' => colors.primary,
      'action.onPrimary' => colors.onPrimary,
      'border.default' => colors.outlineVariant,
      'transparent' => Colors.transparent,
      _ => Colors.transparent,
    };
  }

  EdgeInsetsDirectional _edgeInsets(MosaicEdgeInsets value) =>
      EdgeInsetsDirectional.fromSTEB(
        value.start,
        value.top,
        value.end,
        value.bottom,
      );

  MainAxisAlignment _mainAxisAlignment(
    MosaicMainAxisDistribution distribution,
  ) =>
      switch (distribution) {
        MosaicMainAxisDistribution.start => MainAxisAlignment.start,
        MosaicMainAxisDistribution.center => MainAxisAlignment.center,
        MosaicMainAxisDistribution.end => MainAxisAlignment.end,
        MosaicMainAxisDistribution.spaceBetween =>
          MainAxisAlignment.spaceBetween,
      };

  CrossAxisAlignment _crossAxisAlignment(
    MosaicStackHorizontalAlignment alignment,
  ) =>
      switch (alignment) {
        MosaicStackHorizontalAlignment.start => CrossAxisAlignment.start,
        MosaicStackHorizontalAlignment.center => CrossAxisAlignment.center,
        MosaicStackHorizontalAlignment.end => CrossAxisAlignment.end,
        MosaicStackHorizontalAlignment.stretch => CrossAxisAlignment.stretch,
      };

  TextAlign _textAlign(MosaicTextAlignment alignment) => switch (alignment) {
        MosaicTextAlignment.start => TextAlign.start,
        MosaicTextAlignment.center => TextAlign.center,
        MosaicTextAlignment.end => TextAlign.end,
      };
}

/// Native horizontally paged Carousel that measures every page before
/// presenting the largest-page height required by Protocol 0.2.
final class MosaicCarouselViewport extends StatefulWidget {
  const MosaicCarouselViewport({
    required this.resetToken,
    required this.initialPageIndex,
    required this.pages,
    required this.pageLabels,
    required this.label,
    required this.showsIndicators,
    required this.textDirection,
    required this.onPageChanged,
    this.hint,
    super.key,
  });

  final Object resetToken;
  final int initialPageIndex;
  final List<Widget> pages;
  final List<String> pageLabels;
  final String label;
  final String? hint;
  final bool showsIndicators;
  final TextDirection textDirection;
  final ValueChanged<int> onPageChanged;

  @override
  State<MosaicCarouselViewport> createState() => _MosaicCarouselViewportState();
}

final class _MosaicCarouselViewportState extends State<MosaicCarouselViewport> {
  late PageController _controller;
  late int _currentPage;
  double? _pageHeight;
  final GlobalKey _measurementKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _reset();
  }

  @override
  void didUpdateWidget(MosaicCarouselViewport oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.resetToken != widget.resetToken) {
      _controller.dispose();
      _reset();
    }
  }

  void _reset() {
    _currentPage = widget.initialPageIndex;
    _controller = PageController(initialPage: _currentPage);
    _pageHeight = null;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_pageHeight == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final size = _measurementKey.currentContext?.size;
        if (size != null && size.height > 0) {
          setState(() {
            _pageHeight = size.height;
          });
        }
      });
      return LayoutBuilder(
        builder: (context, constraints) {
          return Opacity(
            opacity: 0,
            child: ExcludeSemantics(
              child: Stack(
                key: _measurementKey,
                children: <Widget>[
                  for (final page in widget.pages)
                    SizedBox(width: constraints.maxWidth, child: page),
                ],
              ),
            ),
          );
        },
      );
    }
    final pageSummary =
        '${widget.pageLabels[_currentPage]}, ${_currentPage + 1} of '
        '${widget.pages.length}';
    return Semantics(
      container: true,
      explicitChildNodes: true,
      label: widget.label,
      hint: widget.hint,
      value: pageSummary,
      child: SizedBox(
        height: _pageHeight! + (widget.showsIndicators ? 28 : 0),
        child: Column(
          children: <Widget>[
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: widget.pages.length,
                onPageChanged: (page) {
                  setState(() {
                    _currentPage = page;
                  });
                  widget.onPageChanged(page);
                  unawaited(
                    SemanticsService.sendAnnouncement(
                      View.of(context),
                      '${widget.pageLabels[page]}, ${page + 1} of '
                      '${widget.pages.length}',
                      widget.textDirection,
                    ),
                  );
                },
                itemBuilder: (context, index) => Semantics(
                  label: widget.pageLabels[index],
                  child: widget.pages[index],
                ),
              ),
            ),
            if (widget.showsIndicators)
              ExcludeSemantics(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    for (var index = 0; index < widget.pages.length; index += 1)
                      Container(
                        width: 8,
                        height: 8,
                        margin: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: index == _currentPage
                              ? Theme.of(context).colorScheme.primary
                              : Theme.of(context).colorScheme.outlineVariant,
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

extension<T> on List<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
