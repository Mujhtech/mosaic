part of 'renderer.dart';

extension on _MosaicPaywallState {
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
    _setPaywallState(() {
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
    _setPaywallState(() {
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
    _setPaywallState(() {
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
        case MosaicPurchasePending():
          widget.onInteraction?.call(
            MosaicInteraction(
              outcome: MosaicInteractionOutcome.pending,
              productReferenceId: referenceId,
              productSelectorId: selectorId,
            ),
          );
          widget.onResult(
            MosaicPendingPresentationResult(productReferenceId: referenceId),
          );
        case MosaicPurchaseDeferred():
          widget.onInteraction?.call(
            MosaicInteraction(
              outcome: MosaicInteractionOutcome.deferred,
              productReferenceId: referenceId,
              productSelectorId: selectorId,
            ),
          );
          widget.onResult(
            MosaicDeferredPresentationResult(productReferenceId: referenceId),
          );
        case MosaicPurchaseProductUnavailable():
          _notifyProductUnavailable(selectorId, referenceId: referenceId);
        case MosaicPurchaseProviderUnavailable():
          _reportPurchaseFailure(
            selectorId: selectorId,
            referenceId: referenceId,
            diagnosticCode: 'purchase_provider_unavailable',
          );
        case MosaicPurchaseConfigurationUnavailable():
          widget.onResult(
            const MosaicConfigurationUnavailablePresentationResult(
              diagnosticCode: 'commerce_configuration_unavailable',
            ),
          );
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
        _setPaywallState(() {
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
    _setPaywallState(() {
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
        case MosaicNothingToRestore():
          widget.onInteraction?.call(
            const MosaicInteraction(
              outcome: MosaicInteractionOutcome.restoreNoPurchases,
            ),
          );
        case MosaicRestoreCancelled():
          widget.onInteraction?.call(
            const MosaicInteraction(
              outcome: MosaicInteractionOutcome.restoreCancelled,
            ),
          );
        case MosaicRestoreProviderUnavailable():
          _reportRestoreFailure('restore_provider_unavailable');
        case MosaicRestoreConfigurationUnavailable():
          widget.onResult(
            const MosaicConfigurationUnavailablePresentationResult(
              diagnosticCode: 'commerce_configuration_unavailable',
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
        _setPaywallState(() {
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
    _setPaywallState(() {
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
    _setPaywallState(() {
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
    _setPaywallState(() {
      _busyActionId = buttonId;
    });
    var opened = false;
    try {
      opened = await widget.externalUrlOpener(action.url);
    } on Object {
      opened = false;
    } finally {
      if (mounted && _busyActionId == buttonId) {
        _setPaywallState(() {
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
      _setPaywallState(() {
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
}
