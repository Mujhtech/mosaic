import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import 'commerce.dart';
import 'configuration.dart';
import 'localization.dart';
import 'presentation.dart';
import 'protocol.dart';

typedef MosaicBundledImageResolver = ImageProvider<Object>? Function(
  String logicalKey,
);

/// Maps a Protocol bundled video key to a Flutter asset path.
typedef MosaicBundledVideoResolver = String? Function(String logicalKey);

typedef MosaicClock = DateTime Function();

typedef MosaicExternalUrlOpener = Future<bool> Function(Uri url);

typedef _AvailableProductOption = ({
  String selectionId,
  MosaicProductCardComponent? card,
  MosaicProductReference reference,
  MosaicProduct product,
});

DateTime _mosaicSystemClock() => DateTime.now().toUtc();

Future<bool> _mosaicExternalUrlOpener(Uri url) => launchUrl(
      url,
      mode: LaunchMode.externalApplication,
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
    this.videoResolver,
    this.onInteraction,
    this.onDiagnostic,
    this.externalUrlOpener = _mosaicExternalUrlOpener,
    this.loadingBuilder,
    super.key,
  });

  final Mosaic mosaic;
  final String? candidateDocument;
  final MosaicBundledDocumentLoader bundledFallbackLoader;
  final String? requestedLocale;
  final MosaicBundledImageResolver? imageResolver;
  final MosaicBundledVideoResolver? videoResolver;
  final MosaicPresentationResultCallback onResult;
  final MosaicInteractionCallback? onInteraction;
  final MosaicDiagnosticCallback? onDiagnostic;
  final MosaicExternalUrlOpener externalUrlOpener;
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
              videoResolver: widget.videoResolver,
              onResult: widget.onResult,
              onInteraction: widget.onInteraction,
              onDiagnostic: widget.onDiagnostic,
              externalUrlOpener: widget.externalUrlOpener,
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

/// Native Flutter renderer for a fully validated Protocol 0.2 document.
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
    this.videoResolver,
    this.onInteraction,
    this.onDiagnostic,
    this.clock = _mosaicSystemClock,
    this.externalUrlOpener = _mosaicExternalUrlOpener,
    super.key,
  });

  final MosaicPaywallDocument document;
  final MosaicPurchaseProvider purchaseProvider;
  final String? requestedLocale;
  final MosaicBundledImageResolver? imageResolver;
  final MosaicBundledVideoResolver? videoResolver;
  final MosaicPresentationResultCallback onResult;
  final MosaicInteractionCallback? onInteraction;
  final MosaicDiagnosticCallback? onDiagnostic;
  final MosaicClock clock;
  final MosaicExternalUrlOpener externalUrlOpener;

  @override
  State<MosaicPaywall> createState() => _MosaicPaywallState();
}

final class _MosaicPaywallState extends State<MosaicPaywall> {
  final ScrollController _scrollController = ScrollController();
  final Map<String, MosaicProduct> _availableProducts =
      <String, MosaicProduct>{};
  final Map<String, String?> _selectedProductCardIds = <String, String?>{};
  final Set<String> _notifiedUnavailableSelectors = <String>{};
  final Set<String> _notifiedHiddenPurchaseTargets = <String>{};
  final Set<String> _notifiedMediaFailures = <String>{};
  final Set<String> _notifiedUnboundedFill = <String>{};
  final Map<String, bool> _switchValues = <String, bool>{};
  final Map<String, int> _carouselPages = <String, int>{};
  final Map<String, double> _screenScrollOffsets = <String, double>{};
  final List<String> _navigationHistory = <String>[];
  final FocusNode _screenFocusNode = FocusNode(debugLabel: 'Mosaic screen');
  final FocusNode _sheetFocusNode = FocusNode(debugLabel: 'Mosaic sheet');
  ScrollController? _sheetScrollController;
  String? _presentedSheetId;
  final Set<String> _programmaticSheetDismissals = <String>{};

  late MosaicResolvedLocalization _localization;
  bool _productsResolved = false;
  String? _busyActionId;
  int _loadGeneration = 0;
  Timer? _countdownTimer;
  String? _currentScreenId;

  @override
  void initState() {
    super.initState();
    _resolveLocalization();
    _resetRuntimeState();
    _resetNavigationState();
    _configureCountdownTimer();
    unawaited(_loadProducts());
  }

  @override
  void didUpdateWidget(MosaicPaywall oldWidget) {
    super.didUpdateWidget(oldWidget);
    final documentChanged = oldWidget.document != widget.document;
    final localeChanged = oldWidget.requestedLocale != widget.requestedLocale;
    if (documentChanged || localeChanged) {
      _resolveLocalization();
    }
    if (documentChanged) {
      _resetRuntimeState();
      _resetNavigationState();
      _configureCountdownTimer();
    }
    if (documentChanged ||
        oldWidget.purchaseProvider != widget.purchaseProvider) {
      _availableProducts.clear();
      if (documentChanged) {
        _selectedProductCardIds.clear();
      }
      _notifiedUnavailableSelectors.clear();
      _productsResolved = false;
      unawaited(_loadProducts());
    } else if (localeChanged && _productsResolved) {
      _reconcileProductSelections();
      final document = widget.document;
      final requestedLocale = widget.requestedLocale;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted ||
            widget.document != document ||
            widget.requestedLocale != requestedLocale) {
          return;
        }
        _notifyUnavailableSelections();
      });
    }
  }

  @override
  void dispose() {
    _loadGeneration += 1;
    _countdownTimer?.cancel();
    _scrollController.dispose();
    _sheetScrollController?.dispose();
    _screenFocusNode.dispose();
    _sheetFocusNode.dispose();
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

  void _resetNavigationState() {
    _navigationHistory
      ..clear()
      ..addAll(
        widget.document.initialScreenId == null
            ? const <String>[]
            : <String>[widget.document.initialScreenId!],
      );
    _screenScrollOffsets.clear();
    _currentScreenId = widget.document.initialScreenId;
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
      _reconcileProductSelections();
    });

    _notifyUnavailableSelections();
  }

  void _reconcileProductSelections() {
    for (final selector
        in widget.document.nodes.whereType<MosaicProductSelectorComponent>()) {
      final availableOptions = _availableOptions(selector);
      final configuredInitial = selector.cards.isEmpty
          ? selector.initiallySelectedProductReferenceId
          : selector.initialProductCardId;
      final candidate = _selectedProductCardIds.containsKey(selector.id)
          ? _selectedProductCardIds[selector.id]
          : configuredInitial;
      final selection =
          availableOptions.any((option) => option.selectionId == candidate)
              ? candidate
              : availableOptions.firstOrNull?.selectionId;
      _selectedProductCardIds[selector.id] = selection;
      if (selection != null) {
        _notifiedUnavailableSelectors.remove(selector.id);
      }
    }
  }

  void _notifyUnavailableSelections() {
    for (final selector
        in widget.document.nodes.whereType<MosaicProductSelectorComponent>()) {
      if (_selectedProductCardIds[selector.id] == null) {
        _notifyUnavailableSelector(selector);
      }
    }
  }

  List<_AvailableProductOption> _availableOptions(
    MosaicProductSelectorComponent selector,
  ) {
    if (selector.cards.isEmpty) {
      return <_AvailableProductOption>[
        for (final referenceId in selector.productReferenceIds)
          if (widget.document.productReference(referenceId)
              case final reference?)
            if (_availableProducts[reference.productId] case final product?)
              if (_hasLocalizedPrice(product))
                (
                  selectionId: reference.id,
                  card: null,
                  reference: reference,
                  product: product,
                ),
      ];
    }
    return <_AvailableProductOption>[
      for (final card in selector.cards)
        if (widget.document.productReference(card.productReferenceId)
            case final reference?)
          if (_availableProducts[reference.productId] case final product?)
            if (_productCardIsAvailable(card, product))
              (
                selectionId: card.id,
                card: card,
                reference: reference,
                product: product,
              ),
    ];
  }

  bool _productCardIsAvailable(
    MosaicProductCardComponent card,
    MosaicProduct product,
  ) {
    if (!_productCardRequiresPrice(card)) return true;
    return _hasLocalizedPrice(product);
  }

  bool _hasLocalizedPrice(MosaicProduct product) =>
      product.localizedPrice?.trim().isNotEmpty ?? false;

  bool _productCardRequiresPrice(MosaicProductCardComponent card) {
    if (card.accessibilityLabel case final label?) {
      if (_productTemplateUsesPrice(_localization.text(label))) return true;
    }
    for (final node in _productCardDescendants(card)) {
      if (node is MosaicTextComponent &&
          _productTemplateUsesPrice(_localization.text(node.value))) {
        return true;
      }
    }
    return false;
  }

  Iterable<MosaicNode> _productCardDescendants(
    MosaicProductCardComponent card,
  ) sync* {
    Iterable<MosaicNode> visit(MosaicNode node) sync* {
      yield node;
      final children = switch (node) {
        MosaicStackNode() => node.children,
        MosaicProductBadgeComponent() => node.children,
        _ => const <MosaicNode>[],
      };
      for (final child in children) {
        yield* visit(child);
      }
    }

    for (final child in card.children) {
      yield* visit(child);
    }
  }

  bool _productTemplateUsesPrice(String value) => RegExp(
        r'\{\{\s*product\.price\s*\}\}',
      ).hasMatch(value);

  void _notifyUnavailableSelector(MosaicProductSelectorComponent selector) {
    if (!_notifiedUnavailableSelectors.add(selector.id)) {
      return;
    }
    widget.onDiagnostic?.call(
      MosaicDiagnostic(
        code: 'product.unavailable',
        message:
            'Product Selector ${selector.id} has no available Product Card.',
        severity: MosaicDiagnosticSeverity.warning,
      ),
    );
    _notifyProductUnavailable(
      selector.id,
      referenceId: selector.cards.isEmpty
          ? selector.initiallySelectedProductReferenceId
          : selector.cards
              .where((card) => card.id == selector.initialProductCardId)
              .firstOrNull
              ?.productReferenceId,
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

  void _selectProduct(
    String selectorId,
    String selectionId,
    String productReferenceId,
  ) {
    if (_busyActionId != null ||
        _selectedProductCardIds[selectorId] == selectionId) {
      return;
    }
    setState(() {
      _selectedProductCardIds[selectorId] = selectionId;
    });
    widget.onInteraction?.call(
      MosaicInteraction(
        outcome: MosaicInteractionOutcome.productSelected,
        productReferenceId: productReferenceId,
        productSelectorId: selectorId,
      ),
    );
  }

  Future<void> _purchase(
    MosaicPurchaseAction action,
    String buttonId,
  ) async {
    if (_busyActionId != null) {
      return;
    }
    final selectorId = action.productSelectorId;
    final selector = widget.document.nodes
        .whereType<MosaicProductSelectorComponent>()
        .firstWhere((candidate) => candidate.id == selectorId);
    final selectedId = _selectedProductCardIds[selectorId];
    final selectedOption = _availableOptions(selector)
        .where((option) => option.selectionId == selectedId)
        .firstOrNull;
    if (selectedOption == null) {
      _notifyProductUnavailable(
        selectorId,
        referenceId: selector.cards.isEmpty
            ? selector.initiallySelectedProductReferenceId
            : selector.cards
                .where((card) => card.id == selector.initialProductCardId)
                .firstOrNull
                ?.productReferenceId,
      );
      return;
    }
    final reference = selectedOption.reference;
    final referenceId = reference.id;
    setState(() {
      _busyActionId = buttonId;
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
      if (mounted && _busyActionId == buttonId) {
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

  Future<void> _restore(String buttonId) async {
    if (_busyActionId != null) {
      return;
    }
    setState(() {
      _busyActionId = buttonId;
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
      if (mounted && _busyActionId == buttonId) {
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
    _dismissPresentedSheet(programmatic: true);
    _navigationHistory.clear();
    _screenScrollOffsets.clear();
    widget.onInteraction?.call(
      const MosaicInteraction(outcome: MosaicInteractionOutcome.dismissed),
    );
    widget.onResult(const MosaicDismissedPresentationResult());
  }

  void _navigateTo(MosaicNavigateToAction action) {
    if (_currentScreenId == null || action.screenId == _currentScreenId) return;
    final destination = widget.document.screen(action.screenId)!;
    _rememberCurrentScrollOffset();
    setState(() {
      _navigationHistory.add(action.screenId);
      _currentScreenId = action.screenId;
    });
    _presentDestination(destination, offset: 0);
  }

  void _navigateBack() {
    if (_navigationHistory.length <= 1) {
      widget.onDiagnostic?.call(
        const MosaicDiagnostic(
          code: 'navigation.noBackTarget',
          message:
              'navigateBack was ignored because the Paywall Screen history is empty.',
          severity: MosaicDiagnosticSeverity.warning,
        ),
      );
      return;
    }
    _rememberCurrentScrollOffset();
    _navigationHistory.removeLast();
    final destinationId = _navigationHistory.last;
    final destination = widget.document.screen(destinationId)!;
    setState(() {
      _currentScreenId = destinationId;
    });
    _presentDestination(
      destination,
      offset: _screenScrollOffsets[destinationId] ?? 0,
    );
  }

  void _presentDestination(
    MosaicPaywallScreen destination, {
    required double offset,
  }) {
    if (destination.presentation == MosaicScreenPresentation.sheet) {
      unawaited(_replacePresentedSheet(destination));
    } else {
      _dismissPresentedSheet(programmatic: true);
      _finishNavigation(offset: offset);
    }
  }

  void _rememberCurrentScrollOffset() {
    final controller =
        _currentScreen?.presentation == MosaicScreenPresentation.sheet
            ? _sheetScrollController
            : _scrollController;
    if (_currentScreenId != null && (controller?.hasClients ?? false)) {
      _screenScrollOffsets[_currentScreenId!] = controller!.offset;
    }
  }

  void _finishNavigation({required double offset}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final controller =
          _currentScreen?.presentation == MosaicScreenPresentation.sheet
              ? _sheetScrollController
              : _scrollController;
      if (controller?.hasClients ?? false) {
        final position = controller!.position;
        controller.jumpTo(offset.clamp(0, position.maxScrollExtent));
      }
      final focusNode =
          _currentScreen?.presentation == MosaicScreenPresentation.sheet
              ? _sheetFocusNode
              : _screenFocusNode;
      focusNode.requestFocus();
      final label = _currentScreen?.accessibilityLabel;
      final focusContext = focusNode.context;
      if (label != null &&
          focusContext != null &&
          MediaQuery.supportsAnnounceOf(focusContext)) {
        SemanticsService.sendAnnouncement(
          View.of(focusContext),
          _localization.text(label),
          _localization.textDirection,
        );
      }
    });
  }

  Future<void> _openExternalUrl(
    MosaicOpenExternalUrlAction action,
    String buttonId,
  ) async {
    if (_busyActionId != null) return;
    setState(() {
      _busyActionId = buttonId;
    });
    var opened = false;
    try {
      opened = await widget.externalUrlOpener(action.url);
    } on Object {
      opened = false;
    } finally {
      if (mounted && _busyActionId == buttonId) {
        setState(() {
          _busyActionId = null;
        });
      }
    }
    if (!mounted || opened) return;
    widget.onDiagnostic?.call(
      const MosaicDiagnostic(
        code: 'externalUrl.openFailed',
        message: 'The external HTTPS URL could not be opened.',
        severity: MosaicDiagnosticSeverity.warning,
      ),
    );
  }

  MosaicPaywallScreen? get _currentScreen => _currentScreenId == null
      ? null
      : widget.document.screen(_currentScreenId!);

  MosaicPaywallScreen? get _baseScreen {
    for (final id in _navigationHistory.reversed) {
      final screen = widget.document.screen(id);
      if (screen?.presentation == MosaicScreenPresentation.screen) {
        return screen;
      }
    }
    return widget.document.initialScreen;
  }

  Future<void> _replacePresentedSheet(MosaicPaywallScreen screen) async {
    if (_presentedSheetId != null) {
      _dismissPresentedSheet(programmatic: true);
      while (mounted && _presentedSheetId != null) {
        await Future<void>.delayed(const Duration(milliseconds: 1));
      }
    }
    if (!mounted || _currentScreenId != screen.id) return;
    _presentedSheetId = screen.id;
    final routeId = screen.id;
    _sheetScrollController?.dispose();
    _sheetScrollController = ScrollController(
      initialScrollOffset: _screenScrollOffsets[screen.id] ?? 0,
    );
    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: false,
      builder: (sheetContext) {
        final height = MediaQuery.sizeOf(sheetContext).height -
            MediaQuery.paddingOf(sheetContext).top;
        return Directionality(
          textDirection: _localization.textDirection,
          child: Material(
            type: MaterialType.transparency,
            child: SizedBox(
              height: height,
              child: _buildScreenSurface(
                sheetContext,
                screen,
                _sheetScrollController!,
              ),
            ),
          ),
        );
      },
    );
    if (_presentedSheetId != routeId) return;
    _presentedSheetId = null;
    if (!mounted || _programmaticSheetDismissals.remove(routeId)) {
      return;
    }
    if (_currentScreenId == routeId) {
      _rememberCurrentScrollOffset();
      setState(() {
        if (_navigationHistory.isNotEmpty) _navigationHistory.removeLast();
        _currentScreenId = _navigationHistory.lastOrNull;
      });
      final destinationId = _currentScreenId;
      if (destinationId == null) return;
      _presentDestination(
        widget.document.screen(destinationId)!,
        offset: _screenScrollOffsets[destinationId] ?? 0,
      );
    }
  }

  void _dismissPresentedSheet({required bool programmatic}) {
    if (_presentedSheetId == null || !mounted) return;
    if (programmatic) {
      _programmaticSheetDismissals.add(_presentedSheetId!);
    }
    Navigator.of(context, rootNavigator: true).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final screen = _baseScreen;
    final result = _buildScreenSurface(context, screen, _scrollController);
    return Directionality(
      textDirection: _localization.textDirection,
      child: Material(
        type: MaterialType.transparency,
        child: result,
      ),
    );
  }

  Widget _buildScreenSurface(
    BuildContext context,
    MosaicPaywallScreen? screen,
    ScrollController controller,
  ) {
    final layout = screen?.layout ?? widget.document.layout;
    Widget content = _buildNode(context, layout.content);
    if (layout.background case final background?) {
      content = _applyBackground(context, background, content);
    }
    final scrollView = SingleChildScrollView(
      key: const ValueKey<String>('mosaic-paywall-scroll'),
      controller: controller,
      child: content,
    );
    final scrollable = layout.showsIndicators
        ? Scrollbar(
            controller: controller,
            thumbVisibility: true,
            child: scrollView,
          )
        : scrollView;
    Widget result = SafeArea(child: scrollable);
    if (screen != null) {
      final label = screen.accessibilityLabel == null
          ? null
          : _localization.text(screen.accessibilityLabel!);
      result = Focus(
        focusNode: screen.presentation == MosaicScreenPresentation.sheet
            ? _sheetFocusNode
            : _screenFocusNode,
        child: Semantics(
          key: ValueKey<String>('mosaic-screen-${screen.id}'),
          container: true,
          explicitChildNodes: true,
          focusable: true,
          label: label,
          child: result,
        ),
      );
    }
    return result;
  }

  Widget _buildStack(
    BuildContext context,
    MosaicStackNode stack, {
    _AvailableProductOption? productOption,
  }) {
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
      final child = _buildNode(
        context,
        stack.children[index],
        productOption: productOption,
      );
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
        mainAxisSize: stack.sizing?.width.mode == MosaicSizingMode.fill
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
                stack.sizing?.height.mode == MosaicSizingMode.fixed
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

  Widget _buildNode(
    BuildContext context,
    MosaicNode node, {
    _AvailableProductOption? productOption,
  }) {
    final content = switch (node) {
      MosaicVerticalStack() =>
        _buildStack(context, node, productOption: productOption),
      MosaicStackComponent() =>
        _buildStack(context, node, productOption: productOption),
      MosaicTextComponent() =>
        _buildText(context, node, productOption: productOption),
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
      MosaicButtonComponent() => _buildButton(context, node),
      MosaicIconComponent() => _buildIcon(context, node),
      MosaicProductCardComponent() ||
      MosaicProductBadgeComponent() =>
        const SizedBox.shrink(),
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
          sizing: node.sizing,
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
          sizing: node.sizing,
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
      MosaicButtonComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance == null
              ? null
              : MosaicBoxAppearance(
                  background: node.appearance!.background,
                  border: node.appearance!.border,
                  cornerRadius: node.appearance!.cornerRadius,
                  opacity: node.appearance!.opacity,
                  clipContent: node.appearance!.clipContent,
                  shadow: node.appearance!.shadow,
                ),
          sizing: _accessibleButtonSizing(node.sizing),
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicIconComponent() => _decorateNode(
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

  Widget _buildText(
    BuildContext context,
    MosaicTextComponent component, {
    _AvailableProductOption? productOption,
  }) {
    final localizedValue = _localization.text(component.value);
    final value = productOption == null
        ? localizedValue
        : _interpolateProductTemplate(localizedValue, productOption);
    final style = _textStyle(context, component.typography, component.style);
    final accessibilityLabel = component.accessibility.label == null
        ? value
        : _localization.text(component.accessibility.label!);
    final result = Semantics(
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
    return result;
  }

  Widget _buildImage(BuildContext context, MosaicImageComponent component) {
    final asset = widget.document.imageAsset(component.assetId)!;
    final placeholder = _imagePlaceholder(context, asset);
    final provider = _imageProvider(asset);
    final content = provider == null
        ? placeholder
        : Image(
            image: provider,
            fit: component.contentMode == MosaicImageContentMode.fit
                ? BoxFit.contain
                : BoxFit.cover,
            errorBuilder: (context, error, stackTrace) {
              _notifyMediaFailure(
                'image-component-${component.id}',
                'background.imageUnavailable',
                'Image ${component.id} is unavailable; its placeholder is used.',
              );
              return placeholder;
            },
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

  ImageProvider<Object>? _imageProvider(MosaicImageAsset asset) {
    try {
      return switch (asset.source) {
        MosaicBundledAssetSource(:final key) => widget.imageResolver?.call(key),
        MosaicRemoteAssetSource(:final url) => NetworkImage(url.toString()),
      };
    } on Object {
      return null;
    }
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
                Icons.check,
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
      final options = _availableOptions(component);
      if (options.isEmpty) {
        final message =
            _localization.text(component.unavailableFallback.message);
        content = Semantics(
          key: ValueKey<String>('mosaic-${component.id}-unavailable'),
          liveRegion: true,
          label: message,
          child: ExcludeSemantics(child: Text(message)),
        );
      } else {
        final renderedOptions = <Widget>[];
        for (var index = 0; index < options.length; index += 1) {
          if (index > 0 && component.itemSpacing > 0) {
            renderedOptions.add(
              component.direction == MosaicProductSelectorDirection.vertical
                  ? SizedBox(height: component.itemSpacing)
                  : SizedBox(width: component.itemSpacing),
            );
          }
          final option = options[index];
          final rendered = option.card == null
              ? _buildLegacyProductOption(context, component, option)
              : _buildProductCard(context, component, option);
          final cardWidth = option.card?.sizing?.width.mode;
          renderedOptions.add(
            component.direction == MosaicProductSelectorDirection.horizontal &&
                    cardWidth == MosaicSizingMode.fill
                ? Expanded(child: rendered)
                : rendered,
          );
        }
        content = component.direction == MosaicProductSelectorDirection.vertical
            ? Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment:
                    _crossAxisAlignment(component.crossAxisAlignment),
                children: renderedOptions,
              )
            : _horizontalSelector(component, renderedOptions);
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

  Widget _horizontalSelector(
    MosaicProductSelectorComponent selector,
    List<Widget> children,
  ) {
    final row = Row(
      mainAxisSize: MainAxisSize.max,
      crossAxisAlignment: _crossAxisAlignment(selector.crossAxisAlignment),
      children: children,
    );
    return selector.crossAxisAlignment == MosaicStackHorizontalAlignment.stretch
        ? IntrinsicHeight(child: row)
        : row;
  }

  Widget _buildLegacyProductOption(
    BuildContext context,
    MosaicProductSelectorComponent selector,
    _AvailableProductOption option,
  ) {
    final reference = option.reference;
    final product = option.product;
    final selected = _selectedProductCardIds[selector.id] == option.selectionId;
    final enabled = _busyActionId == null;
    final label = <String>[
      _localization.text(reference.label),
      if (reference.badge case final badge?) _localization.text(badge),
      if (product.localizedPrice case final price?) price,
      if (product.localizedPeriod case final period?) period,
    ].join(', ');
    final colorScheme = Theme.of(context).colorScheme;
    return Semantics(
      key: ValueKey<String>('mosaic-${selector.id}-${reference.id}'),
      button: true,
      selected: selected,
      checked: selected,
      inMutuallyExclusiveGroup: true,
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
                ? () => _selectProduct(
                      selector.id,
                      option.selectionId,
                      reference.id,
                    )
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
                          product.localizedPrice ?? '',
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

  Widget _buildProductCard(
    BuildContext context,
    MosaicProductSelectorComponent selector,
    _AvailableProductOption option,
  ) {
    final card = option.card!;
    final selected = _selectedProductCardIds[selector.id] == option.selectionId;
    final enabled = _busyActionId == null;
    final style = card.styles.resolve(selected: selected);
    final nestedChildren = card.children.where(
      (child) =>
          child is! MosaicProductBadgeComponent ||
          child.placement is MosaicNestedProductBadgePlacement,
    );
    final layout = _buildAuthoredProductLayout(
      context,
      direction: card.direction,
      gap: card.gap,
      mainAxisDistribution: card.mainAxisDistribution,
      crossAxisAlignment: card.crossAxisAlignment,
      children: nestedChildren,
      option: option,
      selected: selected,
    );
    final overlays = card.children
        .whereType<MosaicProductBadgeComponent>()
        .where((badge) => badge.placement is MosaicOverlayProductBadgePlacement)
        .toList(growable: false);
    final Widget cardContent = Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        Padding(padding: _edgeInsets(style.padding), child: layout),
        for (final badge in overlays)
          _positionProductBadge(
            badge,
            _buildProductBadge(
              context,
              badge,
              option: option,
              selected: selected,
            ),
          ),
      ],
    );
    final label = _productCardSemanticLabel(card, option);
    final result = Semantics(
      key: ValueKey<String>('mosaic-${card.id}'),
      button: true,
      selected: selected,
      checked: selected,
      inMutuallyExclusiveGroup: true,
      enabled: enabled,
      label: label,
      child: ExcludeSemantics(
        child: Opacity(
          opacity: style.opacity,
          child: Material(
            color: Colors.transparent,
            borderRadius: BorderRadius.circular(style.cornerRadius),
            clipBehavior: Clip.none,
            child: InkWell(
              borderRadius: BorderRadius.circular(style.cornerRadius),
              onTap: enabled
                  ? () => _selectProduct(
                        selector.id,
                        option.selectionId,
                        option.reference.id,
                      )
                  : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: _decorateSurface(
                  context,
                  background: style.background,
                  border: style.border,
                  cornerRadius: style.cornerRadius,
                  shadow: style.shadow,
                  child: cardContent,
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return _applySizing(card, result, card.sizing);
  }

  String _productCardSemanticLabel(
    MosaicProductCardComponent card,
    _AvailableProductOption option,
  ) {
    if (card.accessibilityLabel case final accessibilityLabel?) {
      return _interpolateProductTemplate(
        _localization.text(accessibilityLabel),
        option,
      );
    }

    final values = <String>[];
    void add(String value) {
      if (value.trim().isNotEmpty) values.add(value);
    }

    void addLocalized(MosaicLocalizedText value) {
      add(
        _interpolateProductTemplate(
          _localization.text(value),
          option,
        ),
      );
    }

    void visit(MosaicNode node) {
      if (!_productCardPassiveNodeIsVisible(node)) return;
      switch (node) {
        case MosaicTextComponent():
          addLocalized(node.accessibility.label ?? node.value);
        case MosaicImageComponent():
          if (!node.accessibility.hidden) {
            addLocalized(node.accessibility.label!);
          }
        case MosaicIconComponent():
          if (!node.accessibility.hidden) {
            addLocalized(node.accessibility.label!);
          }
        case MosaicFeatureListComponent():
          addLocalized(node.accessibility.label);
          for (final item in node.items) {
            addLocalized(item.text);
          }
        case MosaicCountdownComponent():
          final remaining = node.endsAt.difference(widget.clock().toUtc());
          final completed = remaining <= Duration.zero;
          final visible = completed
              ? _localization.text(node.completedText)
              : _formatCountdown(node, remaining);
          if (node.accessibility.label case final countdownLabel?) {
            add('${_localization.text(countdownLabel)}. $visible');
          } else {
            add(visible);
          }
        case MosaicStackNode():
          for (final child in node.children) {
            visit(child);
          }
        case MosaicProductBadgeComponent():
          for (final child in node.children) {
            visit(child);
          }
        default:
          break;
      }
    }

    for (final child in card.children) {
      visit(child);
    }
    if (values.isEmpty) {
      add(_productName(option));
      if (_hasLocalizedPrice(option.product)) {
        add(option.product.localizedPrice!);
      }
    }
    return values.join(', ');
  }

  bool _productCardPassiveNodeIsVisible(MosaicNode node) {
    final visibility = switch (node) {
      MosaicStackComponent() => node.visibility,
      MosaicTextComponent() => node.visibility,
      MosaicImageComponent() => node.visibility,
      MosaicFeatureListComponent() => node.visibility,
      MosaicCountdownComponent() => node.visibility,
      MosaicIconComponent() => node.visibility,
      _ => const MosaicAlwaysVisible(),
    };
    return _visibilityIsVisible(visibility);
  }

  Widget _buildAuthoredProductLayout(
    BuildContext context, {
    required MosaicStackDirection direction,
    required double gap,
    required MosaicMainAxisDistribution mainAxisDistribution,
    required MosaicStackHorizontalAlignment crossAxisAlignment,
    required Iterable<MosaicNode> children,
    required _AvailableProductOption option,
    required bool selected,
    bool shrinkWrap = false,
  }) {
    final rendered = <Widget>[];
    var index = 0;
    for (final child in children) {
      if (index > 0 && gap > 0) {
        rendered.add(
          direction == MosaicStackDirection.horizontal
              ? SizedBox(width: gap)
              : SizedBox(height: gap),
        );
      }
      final widget = child is MosaicProductBadgeComponent
          ? _buildProductBadge(
              context,
              child,
              option: option,
              selected: selected,
            )
          : _buildNode(context, child, productOption: option);
      rendered.add(
        direction == MosaicStackDirection.horizontal && !shrinkWrap
            ? Flexible(child: widget)
            : widget,
      );
      index += 1;
    }
    if (direction == MosaicStackDirection.vertical) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: _mainAxisAlignment(mainAxisDistribution),
        crossAxisAlignment: _crossAxisAlignment(crossAxisAlignment),
        children: rendered,
      );
    }
    final row = Row(
      mainAxisSize: shrinkWrap ? MainAxisSize.min : MainAxisSize.max,
      mainAxisAlignment: _mainAxisAlignment(mainAxisDistribution),
      crossAxisAlignment: _crossAxisAlignment(crossAxisAlignment),
      children: rendered,
    );
    return crossAxisAlignment == MosaicStackHorizontalAlignment.stretch
        ? IntrinsicHeight(child: row)
        : row;
  }

  Widget _buildProductBadge(
    BuildContext context,
    MosaicProductBadgeComponent badge, {
    required _AvailableProductOption option,
    required bool selected,
  }) {
    final style = badge.styles.resolve(selected: selected);
    final content = _buildAuthoredProductLayout(
      context,
      direction: badge.direction,
      gap: badge.gap,
      mainAxisDistribution: badge.mainAxisDistribution,
      crossAxisAlignment: badge.crossAxisAlignment,
      children: badge.children,
      option: option,
      selected: selected,
      shrinkWrap: badge.placement is MosaicOverlayProductBadgePlacement,
    );
    final result = Opacity(
      key: ValueKey<String>('mosaic-${badge.id}'),
      opacity: style.opacity,
      child: _decorateSurface(
        context,
        background: style.background,
        border: style.border,
        cornerRadius: style.cornerRadius,
        shadow: style.shadow,
        child: Padding(
          padding: _edgeInsets(style.padding),
          child: content,
        ),
      ),
    );
    return _applySizing(badge, result, badge.sizing);
  }

  Widget _positionProductBadge(
    MosaicProductBadgeComponent badge,
    Widget child,
  ) {
    final placement = badge.placement as MosaicOverlayProductBadgePlacement;
    return switch (placement.anchor) {
      MosaicProductBadgeAnchor.topStart => PositionedDirectional(
          top: placement.inset,
          start: placement.inset,
          child: child,
        ),
      MosaicProductBadgeAnchor.topEnd => PositionedDirectional(
          top: placement.inset,
          end: placement.inset,
          child: child,
        ),
      MosaicProductBadgeAnchor.bottomStart => PositionedDirectional(
          bottom: placement.inset,
          start: placement.inset,
          child: child,
        ),
      MosaicProductBadgeAnchor.bottomEnd => PositionedDirectional(
          bottom: placement.inset,
          end: placement.inset,
          child: child,
        ),
    };
  }

  String _productName(_AvailableProductOption option) =>
      option.product.title.trim().isEmpty
          ? _localization.text(option.reference.label)
          : option.product.title;

  String _interpolateProductTemplate(
    String value,
    _AvailableProductOption option,
  ) {
    return value.replaceAllMapped(
      RegExp(r'\{\{\s*product\.(name|price)\s*\}\}'),
      (match) => match.group(1) == 'name'
          ? _productName(option)
          : option.product.localizedPrice ?? '',
    );
  }

  Widget _buildButton(
    BuildContext context,
    MosaicButtonComponent component,
  ) {
    final busy = _busyActionId == component.id;
    final children = busy && component.inProgressChildren != null
        ? component.inProgressChildren!
        : component.children;
    var enabled = _busyActionId == null;
    if (component.action case final MosaicPurchaseAction action) {
      final selected = _selectedProductCardIds[action.productSelectorId];
      final targetVisible = _isNodeEffectivelyVisible(action.productSelectorId);
      if (!targetVisible &&
          _notifiedHiddenPurchaseTargets.add(action.productSelectorId)) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && !_isNodeEffectivelyVisible(action.productSelectorId)) {
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
        _notifiedHiddenPurchaseTargets.remove(action.productSelectorId);
      }
      enabled =
          enabled && _productsResolved && selected != null && targetVisible;
    }

    final renderedChildren = <Widget>[];
    for (var index = 0; index < children.length; index += 1) {
      if (index > 0 && component.gap > 0) {
        renderedChildren.add(
          component.direction == MosaicStackDirection.horizontal
              ? SizedBox(width: component.gap)
              : SizedBox(height: component.gap),
        );
      }
      final child = _buildNode(context, children[index]);
      renderedChildren.add(
        component.direction == MosaicStackDirection.horizontal
            ? Flexible(child: child)
            : child,
      );
    }
    final Widget content;
    if (component.direction == MosaicStackDirection.vertical) {
      content = Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: _mainAxisAlignment(component.mainAxisDistribution),
        crossAxisAlignment: _crossAxisAlignment(component.crossAxisAlignment),
        children: renderedChildren,
      );
    } else {
      final row = Row(
        mainAxisSize: component.sizing?.width.mode == MosaicSizingMode.fill
            ? MainAxisSize.max
            : MainAxisSize.min,
        mainAxisAlignment: _mainAxisAlignment(component.mainAxisDistribution),
        crossAxisAlignment: _crossAxisAlignment(component.crossAxisAlignment),
        children: renderedChildren,
      );
      content =
          component.crossAxisAlignment == MosaicStackHorizontalAlignment.stretch
              ? IntrinsicHeight(child: row)
              : row;
    }
    final paddedContent = component.appearance?.padding == null
        ? content
        : Padding(
            padding: _edgeInsets(component.appearance!.padding!),
            child: content,
          );
    final semanticValue = busy
        ? _buttonSemanticValue(component.inProgressChildren ?? const [])
        : null;
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      button: true,
      enabled: enabled,
      liveRegion: busy,
      label: _localization.text(component.accessibility.label),
      hint: component.accessibility.hint == null
          ? null
          : _localization.text(component.accessibility.hint!),
      value: semanticValue?.isEmpty ?? true ? null : semanticValue,
      child: ExcludeSemantics(
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: enabled ? () => _executeButton(component) : null,
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minWidth: 48,
                minHeight: 48,
              ),
              child: paddedContent,
            ),
          ),
        ),
      ),
    );
  }

  void _executeButton(MosaicButtonComponent component) {
    if (_busyActionId != null) return;
    switch (component.action) {
      case final MosaicPurchaseAction action:
        unawaited(_purchase(action, component.id));
      case MosaicRestoreAction():
        unawaited(_restore(component.id));
      case MosaicCloseAction():
        _close();
      case final MosaicNavigateToAction action:
        _navigateTo(action);
      case MosaicNavigateBackAction():
        _navigateBack();
      case final MosaicOpenExternalUrlAction action:
        unawaited(_openExternalUrl(action, component.id));
    }
  }

  String _buttonSemanticValue(Iterable<MosaicNode> nodes) {
    final values = <String>[];
    void visit(MosaicNode node) {
      switch (node) {
        case MosaicTextComponent():
          values.add(
            _localization.text(node.accessibility.label ?? node.value),
          );
        case MosaicImageComponent():
          if (!node.accessibility.hidden) {
            values.add(_localization.text(node.accessibility.label!));
          }
        case MosaicIconComponent():
          if (!node.accessibility.hidden) {
            values.add(_localization.text(node.accessibility.label!));
          }
        case MosaicFeatureListComponent():
          values.add(_localization.text(node.accessibility.label));
        case MosaicCountdownComponent():
          values.add(
            node.accessibility.label == null
                ? _formatCountdown(
                    node,
                    node.endsAt.difference(widget.clock().toUtc()),
                  )
                : _localization.text(node.accessibility.label!),
          );
        case MosaicStackNode():
          for (final child in node.children) {
            visit(child);
          }
        default:
          break;
      }
    }

    for (final node in nodes) {
      visit(node);
    }
    return values.join(', ');
  }

  Widget _buildIcon(BuildContext context, MosaicIconComponent component) {
    final icon = Icon(
      switch (component.name) {
        MosaicIconName.checkmark => Icons.check,
        MosaicIconName.close => Icons.close,
        MosaicIconName.lock => Icons.lock,
        MosaicIconName.restore => Icons.restore,
        MosaicIconName.externalLink => Icons.open_in_new,
        MosaicIconName.arrowBackward => Icons.arrow_back,
        MosaicIconName.arrowForward => Icons.arrow_forward,
        MosaicIconName.chevronBackward => Icons.chevron_left,
        MosaicIconName.chevronForward => Icons.chevron_right,
      },
      size: component.size,
      color: _color(context, component.color),
    );
    if (component.accessibility.hidden) {
      return ExcludeSemantics(
        key: ValueKey<String>('mosaic-${component.id}'),
        child: icon,
      );
    }
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      image: true,
      label: _localization.text(component.accessibility.label!),
      child: ExcludeSemantics(child: icon),
    );
  }

  Widget _buildPurchaseButton(
    BuildContext context,
    MosaicPurchaseButtonComponent component,
  ) {
    final busy = _busyActionId == component.id;
    final selected =
        _selectedProductCardIds[component.action.productSelectorId];
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
                onPressed: enabled
                    ? () => unawaited(
                          _purchase(component.action, component.id),
                        )
                    : null,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(48, 48),
                ),
                child: Text(visibleLabel),
              )
            : TextButton(
                onPressed: enabled
                    ? () => unawaited(
                          _purchase(component.action, component.id),
                        )
                    : null,
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
                    enabled ? () => unawaited(_restore(component.id)) : null,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(48, 48),
                ),
                child: Text(visibleLabel),
              )
            : TextButton(
                onPressed:
                    enabled ? () => unawaited(_restore(component.id)) : null,
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
      result = _decorateSurface(
        context,
        background: appearance.background,
        border: appearance.border,
        cornerRadius: radius,
        shadow: appearance.shadow,
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
    result = _applySizing(node, result, sizing);
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

  Widget _applySizing(
    MosaicNode node,
    Widget child,
    MosaicSizing? sizing,
  ) {
    if (sizing == null) return child;
    return _MosaicAxisSizedBox(
      sizing: sizing,
      onUnboundedFill: (axis) => _notifyUnboundedFill(node.id, axis),
      child: child,
    );
  }

  void _notifyUnboundedFill(String nodeId, String axis) {
    final key = '$nodeId-$axis';
    if (!_notifiedUnboundedFill.add(key)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      widget.onDiagnostic?.call(
        MosaicDiagnostic(
          code: 'layout.unboundedFill',
          message:
              '$nodeId requested Fill on an unbounded $axis axis; Fit is used.',
          severity: MosaicDiagnosticSeverity.warning,
        ),
      );
    });
  }

  Widget _decorateSurface(
    BuildContext context, {
    required Widget child,
    MosaicBackground? background,
    MosaicBorderStyle? border,
    required double cornerRadius,
    MosaicShadow? shadow,
  }) {
    final resolvedBackground = background == null
        ? null
        : widget.document.resolveBackground(background);
    final resolvedShadow =
        shadow == null ? null : widget.document.resolveShadow(shadow);
    final radius =
        cornerRadius == 0 ? null : BorderRadius.circular(cornerRadius);
    final decoration = BoxDecoration(
      color: resolvedBackground is MosaicColorBackground
          ? _color(context, resolvedBackground.color)
          : null,
      gradient: _gradient(context, resolvedBackground),
      border: border == null
          ? null
          : Border.all(
              color: _color(context, border.color),
              width: border.width,
              strokeAlign: BorderSide.strokeAlignInside,
            ),
      borderRadius: radius,
      boxShadow: resolvedShadow == null
          ? null
          : <BoxShadow>[
              BoxShadow(
                color: _color(context, resolvedShadow.color),
                offset: Offset(resolvedShadow.offsetX, resolvedShadow.offsetY),
                blurRadius: resolvedShadow.blurRadius,
              ),
            ],
    );
    Widget content = child;
    if (resolvedBackground is MosaicImageBackground ||
        resolvedBackground is MosaicVideoBackground) {
      final media = _mediaBackground(context, resolvedBackground!);
      content = Stack(
        fit: StackFit.passthrough,
        children: <Widget>[
          Positioned.fill(
            child: radius == null
                ? media
                : ClipRRect(borderRadius: radius, child: media),
          ),
          child,
        ],
      );
    }
    return DecoratedBox(decoration: decoration, child: content);
  }

  Gradient? _gradient(BuildContext context, MosaicBackground? background) {
    switch (background) {
      case MosaicLinearGradientBackground():
        final radians = background.angle * math.pi / 180;
        // Protocol angles are physical canvas directions: zero points right,
        // 90 degrees points down, and RTL never mirrors the result.
        final direction = Alignment(math.cos(radians), math.sin(radians));
        return LinearGradient(
          begin: Alignment(-direction.x, -direction.y),
          end: direction,
          colors: <Color>[
            for (final stop in background.stops) _color(context, stop.color),
          ],
          stops: <double>[
            for (final stop in background.stops) stop.position,
          ],
        );
      case MosaicRadialGradientBackground():
        return RadialGradient(
          center: Alignment(
            background.centerX * 2 - 1,
            background.centerY * 2 - 1,
          ),
          radius: background.radius,
          colors: <Color>[
            for (final stop in background.stops) _color(context, stop.color),
          ],
          stops: <double>[
            for (final stop in background.stops) stop.position,
          ],
        );
      default:
        return null;
    }
  }

  Widget _applyBackground(
    BuildContext context,
    MosaicBackground background,
    Widget child,
  ) =>
      _decorateSurface(
        context,
        background: background,
        cornerRadius: 0,
        child: child,
      );

  Widget _mediaBackground(BuildContext context, MosaicBackground background) {
    if (background is MosaicImageBackground) {
      final asset = widget.document.imageAsset(background.assetId)!;
      final provider = _imageProvider(asset);
      if (provider == null) {
        _notifyMediaFailure(
          background.assetId,
          'background.imageUnavailable',
          'Image background is unavailable; its fallback colour is used.',
        );
        return ColoredBox(color: _color(context, background.fallbackColor));
      }
      return ColoredBox(
        color: _color(context, background.fallbackColor),
        child: Image(
          image: provider,
          fit: background.contentMode == MosaicImageContentMode.fit
              ? BoxFit.contain
              : BoxFit.cover,
          excludeFromSemantics: true,
          errorBuilder: (context, error, stackTrace) {
            _notifyMediaFailure(
              background.assetId,
              'background.imageUnavailable',
              'Image background is unavailable; its fallback colour is used.',
            );
            return const SizedBox.expand();
          },
        ),
      );
    }
    final video = background as MosaicVideoBackground;
    final posterAsset = video.posterAssetId == null
        ? null
        : widget.document.imageAsset(video.posterAssetId!);
    final poster = posterAsset == null ? null : _imageProvider(posterAsset);
    if (posterAsset != null && poster == null) {
      _notifyMediaFailure(
        posterAsset.id,
        'background.imageUnavailable',
        'Video poster is unavailable; the fallback colour is used.',
      );
    }
    return MosaicDecorativeVideo(
      key: ValueKey<String>('mosaic-background-video-${video.assetId}'),
      asset: widget.document.videoAsset(video.assetId)!,
      bundledResolver: widget.videoResolver,
      poster: poster,
      fallbackColor: _color(context, video.fallbackColor),
      fit: video.contentMode == MosaicImageContentMode.fit
          ? BoxFit.contain
          : BoxFit.cover,
      onUnavailable: () => _notifyMediaFailure(
        video.assetId,
        'background.videoUnavailable',
        poster == null
            ? 'Video background is unavailable; its fallback colour is used.'
            : 'Video background is unavailable; its poster is used.',
      ),
      onPosterUnavailable: posterAsset == null
          ? null
          : () => _notifyMediaFailure(
                posterAsset.id,
                'background.imageUnavailable',
                'Video poster is unavailable; the fallback colour is used.',
              ),
    );
  }

  void _notifyMediaFailure(String key, String code, String message) {
    if (!_notifiedMediaFailures.add(key)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      widget.onDiagnostic?.call(
        MosaicDiagnostic(
          code: code,
          message: message,
          severity: MosaicDiagnosticSeverity.warning,
        ),
      );
    });
  }

  MosaicSizing? _accessibleButtonSizing(MosaicSizing? sizing) {
    if (sizing == null) return null;
    final width = sizing.width;
    if (width.mode == MosaicSizingMode.fixed && (width.value ?? 0) < 48) {
      return MosaicSizing(
        width: const MosaicSizingValue.fixed(48),
        height: sizing.height,
      );
    }
    return sizing;
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
            MosaicButtonComponent() => node.visibility,
            MosaicIconComponent() => node.visibility,
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

    final root =
        _currentScreen?.layout.content ?? widget.document.layout.content;
    return visit(root, true) ?? false;
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
    value = widget.document.resolveColor(value);
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

final class _MosaicAxisSizedBox extends SingleChildRenderObjectWidget {
  const _MosaicAxisSizedBox({
    required this.sizing,
    required this.onUnboundedFill,
    required super.child,
  });

  final MosaicSizing sizing;
  final ValueChanged<String> onUnboundedFill;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderMosaicAxisSizedBox(sizing, onUnboundedFill);

  @override
  void updateRenderObject(
    BuildContext context,
    _RenderMosaicAxisSizedBox renderObject,
  ) {
    renderObject
      ..sizing = sizing
      ..onUnboundedFill = onUnboundedFill;
  }
}

final class _RenderMosaicAxisSizedBox extends RenderProxyBox {
  _RenderMosaicAxisSizedBox(this._sizing, this._onUnboundedFill);

  MosaicSizing _sizing;
  ValueChanged<String> _onUnboundedFill;

  set sizing(MosaicSizing value) {
    _sizing = value;
    markNeedsLayout();
  }

  set onUnboundedFill(ValueChanged<String> value) {
    _onUnboundedFill = value;
  }

  double? _dimension(
    MosaicSizingValue value, {
    required bool bounded,
    required double maximum,
    required String axis,
  }) {
    if (value.mode == MosaicSizingMode.fixed) return value.value;
    if (value.mode != MosaicSizingMode.fill) return null;
    if (bounded) return maximum;
    _onUnboundedFill(axis);
    return null;
  }

  @override
  void performLayout() {
    final width = _dimension(
      _sizing.width,
      bounded: constraints.hasBoundedWidth,
      maximum: constraints.maxWidth,
      axis: 'width',
    );
    final height = _dimension(
      _sizing.height,
      bounded: constraints.hasBoundedHeight,
      maximum: constraints.maxHeight,
      axis: 'height',
    );
    final child = this.child;
    if (child == null) {
      size = constraints.constrain(Size(width ?? 0, height ?? 0));
      return;
    }
    child.layout(
      constraints.tighten(width: width, height: height),
      parentUsesSize: true,
    );
    size = constraints.constrain(
      Size(width ?? child.size.width, height ?? child.size.height),
    );
  }

  @override
  double computeMinIntrinsicWidth(double height) =>
      _sizing.width.mode == MosaicSizingMode.fixed
          ? _sizing.width.value!
          : super.computeMinIntrinsicWidth(height);

  @override
  double computeMaxIntrinsicWidth(double height) =>
      _sizing.width.mode == MosaicSizingMode.fixed
          ? _sizing.width.value!
          : super.computeMaxIntrinsicWidth(height);

  @override
  double computeMinIntrinsicHeight(double width) =>
      _sizing.height.mode == MosaicSizingMode.fixed
          ? _sizing.height.value!
          : super.computeMinIntrinsicHeight(width);

  @override
  double computeMaxIntrinsicHeight(double width) =>
      _sizing.height.mode == MosaicSizingMode.fixed
          ? _sizing.height.value!
          : super.computeMaxIntrinsicHeight(width);

  @override
  void paint(PaintingContext context, Offset offset) {
    final fixed = _sizing.width.mode == MosaicSizingMode.fixed ||
        _sizing.height.mode == MosaicSizingMode.fixed;
    if (!fixed) {
      super.paint(context, offset);
      return;
    }
    context.pushClipRect(
      needsCompositing,
      offset,
      Offset.zero & size,
      super.paint,
    );
  }
}

/// A decorative, muted, autoplaying and looping background video.
final class MosaicDecorativeVideo extends StatefulWidget {
  const MosaicDecorativeVideo({
    required this.asset,
    required this.fallbackColor,
    required this.fit,
    required this.onUnavailable,
    this.onPosterUnavailable,
    this.bundledResolver,
    this.poster,
    super.key,
  });

  final MosaicVideoAsset asset;
  final MosaicBundledVideoResolver? bundledResolver;
  final ImageProvider<Object>? poster;
  final Color fallbackColor;
  final BoxFit fit;
  final VoidCallback onUnavailable;
  final VoidCallback? onPosterUnavailable;

  @override
  State<MosaicDecorativeVideo> createState() => _MosaicDecorativeVideoState();
}

final class _MosaicDecorativeVideoState extends State<MosaicDecorativeVideo> {
  VideoPlayerController? _controller;
  bool _ready = false;
  bool _reported = false;

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      final controller = switch (widget.asset.source) {
        MosaicRemoteAssetSource(:final url) =>
          VideoPlayerController.networkUrl(url),
        MosaicBundledAssetSource(:final key) => () {
            final path = widget.bundledResolver?.call(key);
            if (path == null) return null;
            return VideoPlayerController.asset(path);
          }(),
      };
      if (controller == null) {
        _unavailable();
        return;
      }
      _controller = controller;
      await controller.initialize();
      await controller.setVolume(0);
      await controller.setLooping(true);
      await controller.play();
      if (!mounted) return;
      setState(() => _ready = true);
    } on Object {
      _unavailable();
    }
  }

  void _unavailable() {
    if (!_reported) {
      _reported = true;
      widget.onUnavailable();
    }
    if (mounted) setState(() => _ready = false);
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final fallback = ColoredBox(
      color: widget.fallbackColor,
      child: widget.poster == null
          ? const SizedBox.expand()
          : Image(
              image: widget.poster!,
              fit: widget.fit,
              excludeFromSemantics: true,
              errorBuilder: (context, error, stackTrace) {
                widget.onPosterUnavailable?.call();
                return const SizedBox.expand();
              },
            ),
    );
    final controller = _controller;
    if (!_ready || controller == null || !controller.value.isInitialized) {
      return ExcludeSemantics(child: fallback);
    }
    final size = controller.value.size;
    return ExcludeSemantics(
      child: ColoredBox(
        color: widget.fallbackColor,
        child: FittedBox(
          fit: widget.fit,
          clipBehavior: Clip.hardEdge,
          child: SizedBox(
            width: size.width,
            height: size.height,
            child: VideoPlayer(controller),
          ),
        ),
      ),
    );
  }
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
  T? get lastOrNull => isEmpty ? null : last;
}
