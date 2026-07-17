import 'dart:async';

import 'package:flutter/material.dart';

import 'commerce.dart';
import 'configuration.dart';
import 'localization.dart';
import 'presentation.dart';
import 'protocol.dart';

typedef MosaicBundledImageResolver = ImageProvider<Object>? Function(
  String logicalKey,
);

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
    super.key,
  });

  final MosaicPaywallDocument document;
  final MosaicPurchaseProvider purchaseProvider;
  final String? requestedLocale;
  final MosaicBundledImageResolver? imageResolver;
  final MosaicPresentationResultCallback onResult;
  final MosaicInteractionCallback? onInteraction;
  final MosaicDiagnosticCallback? onDiagnostic;

  @override
  State<MosaicPaywall> createState() => _MosaicPaywallState();
}

final class _MosaicPaywallState extends State<MosaicPaywall> {
  final ScrollController _scrollController = ScrollController();
  final Map<String, MosaicProduct> _availableProducts =
      <String, MosaicProduct>{};
  final Map<String, String?> _selectedProductReferences = <String, String?>{};
  final Set<String> _notifiedUnavailableSelectors = <String>{};

  late MosaicResolvedLocalization _localization;
  bool _productsResolved = false;
  String? _busyActionId;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _resolveLocalization();
    unawaited(_loadProducts());
  }

  @override
  void didUpdateWidget(MosaicPaywall oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.document != widget.document ||
        oldWidget.requestedLocale != widget.requestedLocale) {
      _resolveLocalization();
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
    _scrollController.dispose();
    super.dispose();
  }

  void _resolveLocalization() {
    _localization = const MosaicLocaleResolver().resolve(
      widget.document,
      requestedLocale: widget.requestedLocale,
    );
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
    final scrollView = SingleChildScrollView(
      key: const ValueKey<String>('mosaic-paywall-scroll'),
      controller: _scrollController,
      child: _buildStack(context, widget.document.layout.content),
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

  Widget _buildStack(BuildContext context, MosaicVerticalStack stack) {
    final children = <Widget>[];
    for (var index = 0; index < stack.children.length; index += 1) {
      if (index > 0 && stack.spacing > 0) {
        children.add(SizedBox(height: stack.spacing));
      }
      children.add(_buildNode(context, stack.children[index]));
    }
    return Padding(
      key: ValueKey<String>('mosaic-${stack.id}'),
      padding: EdgeInsetsDirectional.fromSTEB(
        stack.padding.start,
        stack.padding.top,
        stack.padding.end,
        stack.padding.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: switch (stack.horizontalAlignment) {
          MosaicStackHorizontalAlignment.start => CrossAxisAlignment.start,
          MosaicStackHorizontalAlignment.center => CrossAxisAlignment.center,
          MosaicStackHorizontalAlignment.end => CrossAxisAlignment.end,
          MosaicStackHorizontalAlignment.stretch => CrossAxisAlignment.stretch,
        },
        children: children,
      ),
    );
  }

  Widget _buildNode(BuildContext context, MosaicNode node) {
    return switch (node) {
      MosaicVerticalStack() => _buildStack(context, node),
      MosaicTextComponent() => _buildText(context, node),
      MosaicImageComponent() => _buildImage(context, node),
      MosaicFeatureListComponent() => _buildFeatureList(context, node),
      MosaicProductSelectorComponent() => _buildProductSelector(context, node),
      MosaicPurchaseButtonComponent() => _buildPurchaseButton(context, node),
      MosaicRestoreButtonComponent() => _buildRestoreButton(context, node),
      MosaicCloseButtonComponent() => _buildCloseButton(context, node),
      MosaicLegalTextComponent() => _buildLegalText(context, node),
      MosaicScrollContainer() => const SizedBox.shrink(),
    };
  }

  Widget _buildText(BuildContext context, MosaicTextComponent component) {
    final value = _localization.text(component.value);
    final style = switch (component.style) {
      MosaicTextStyle.title => Theme.of(context).textTheme.headlineMedium,
      MosaicTextStyle.body => Theme.of(context).textTheme.bodyLarge,
      MosaicTextStyle.caption => Theme.of(context).textTheme.bodySmall,
    };
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      label: value,
      header:
          component.accessibility.role == MosaicTextAccessibilityRole.heading,
      child: ExcludeSemantics(
        child: Text(
          value,
          style: style,
          textAlign: _textAlign(component.alignment),
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
    final frame = AspectRatio(
      aspectRatio: component.aspectRatio,
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
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(_localization.text(item.text))),
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
            options.add(SizedBox(height: component.itemSpacing));
          }
          options
              .add(_buildProductOption(context, component, references[index]));
        }
        content = Column(mainAxisSize: MainAxisSize.min, children: options);
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
    return Semantics(
      key: ValueKey<String>('mosaic-${selector.id}-${reference.id}'),
      button: true,
      selected: selected,
      enabled: enabled,
      label: label,
      child: ExcludeSemantics(
        child: Material(
          color: selected
              ? colorScheme.primaryContainer
              : colorScheme.surfaceContainerLow,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color:
                  selected ? colorScheme.primary : colorScheme.outlineVariant,
              width: selected ? 2 : 1,
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
                padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 12),
                child: Row(
                  children: <Widget>[
                    Icon(
                      selected
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                      color:
                          selected ? colorScheme.primary : colorScheme.outline,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            _localization.text(reference.label),
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          if (reference.badge case final badge?)
                            Text(
                              _localization.text(badge),
                              style: Theme.of(context).textTheme.labelMedium,
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        Text(
                          product.localizedPrice,
                          style: Theme.of(context).textTheme.titleMedium,
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
    final enabled =
        _productsResolved && selected != null && _busyActionId == null;
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
        child: FilledButton(
          onPressed: enabled ? () => unawaited(_purchase(component)) : null,
          style: FilledButton.styleFrom(
            minimumSize: const Size(48, 48),
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
        child: OutlinedButton(
          onPressed: enabled ? () => unawaited(_restore(component)) : null,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(48, 48),
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
          child: Text(_localization.text(component.label)),
        ),
      ),
    );
  }

  Widget _buildLegalText(
    BuildContext context,
    MosaicLegalTextComponent component,
  ) {
    final value = _localization.text(component.value);
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      label: value,
      header:
          component.accessibility.role == MosaicTextAccessibilityRole.heading,
      child: ExcludeSemantics(
        child: Text(
          value,
          style: Theme.of(context).textTheme.bodySmall,
          textAlign: _textAlign(component.alignment),
        ),
      ),
    );
  }

  TextAlign _textAlign(MosaicTextAlignment alignment) => switch (alignment) {
        MosaicTextAlignment.start => TextAlign.start,
        MosaicTextAlignment.center => TextAlign.center,
        MosaicTextAlignment.end => TextAlign.end,
      };
}

extension<T> on List<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
