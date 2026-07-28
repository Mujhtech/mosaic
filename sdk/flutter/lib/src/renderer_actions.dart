part of 'renderer.dart';

extension on _MosaicPaywallState {
  Future<void> _loadProducts() async {
    final generation = ++_loadGeneration;
    final analyticsAttemptId = mosaicAnalyticsId('product_load');
    _productLoadAttemptId = analyticsAttemptId;
    final analyticsStartedAt = widget.clock().toUtc();
    final requestedIds = widget.document.products
        .map((reference) => reference.productId)
        .toList(growable: false);

    if (requestedIds.isNotEmpty) {
      _analytics(
        MosaicAnalyticsEventName.productLoadStarted,
        correlation: widget.analyticsContext?.correlation(
          productLoadAttemptId: analyticsAttemptId,
        ),
        payload: <String, Object?>{
          'requestedProductCount': requestedIds.length.clamp(1, 64),
        },
      );
    }

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
      _analytics(
        MosaicAnalyticsEventName.productLoadFailed,
        correlation: widget.analyticsContext?.correlation(
          productLoadAttemptId: analyticsAttemptId,
        ),
        payload: <String, Object?>{
          'requestedProductCount': requestedIds.length.clamp(1, 64),
          'durationMs': _analyticsDuration(analyticsStartedAt),
          'diagnosticCode': 'commerce.product_load_failed',
          'retryable': true,
        },
      );
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

    if (requestedIds.isNotEmpty) {
      _analytics(
        MosaicAnalyticsEventName.productLoadCompleted,
        correlation: widget.analyticsContext?.correlation(
          productLoadAttemptId: analyticsAttemptId,
        ),
        payload: <String, Object?>{
          'availableProductCount': available.length.clamp(0, 64),
          'unavailableProductCount':
              (requestedIds.length - available.length).clamp(0, 64),
          'durationMs': _analyticsDuration(analyticsStartedAt),
        },
      );
    }

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
    final productId = referenceId == null
        ? null
        : widget.document.productReference(referenceId)?.productId;
    if (productId != null) {
      _analytics(
        MosaicAnalyticsEventName.productUnavailable,
        correlation: widget.analyticsContext?.correlation(
          productLoadAttemptId: _productLoadAttemptId,
        ),
        attribution: widget.analyticsContext?.forProduct(productId),
        payload: const <String, Object?>{'reason': 'product_not_found'},
      );
    }
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
    final productId =
        widget.document.productReference(productReferenceId)?.productId;
    if (productId != null) {
      _analytics(
        MosaicAnalyticsEventName.productSelected,
        attribution: widget.analyticsContext?.forConversion(productId),
        payload: const <String, Object?>{'source': 'user'},
      );
    }
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
        .where((candidate) => candidate.id == selectorId)
        .firstOrNull;
    if (selector == null) {
      _reportRenderingFailure('renderer_invalid_purchase_action');
      return;
    }
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

    final analyticsAttemptId = mosaicAnalyticsId('purchase_attempt');
    final analyticsStartedAt = widget.clock().toUtc();
    final analyticsAttribution =
        widget.analyticsContext?.forConversion(reference.productId);
    _analytics(
      MosaicAnalyticsEventName.paywallActionSelected,
      payload: <String, Object?>{'action': 'purchase', 'componentId': buttonId},
    );
    _analytics(
      MosaicAnalyticsEventName.purchaseStarted,
      correlation: widget.analyticsContext?.correlation(
        purchaseAttemptId: analyticsAttemptId,
      ),
      attribution: analyticsAttribution,
      payload: const <String, Object?>{},
    );

    try {
      final result =
          await widget.purchaseProvider.purchase(reference.productId);
      if (!mounted) {
        return;
      }
      switch (result) {
        case MosaicPurchased(:final activeEntitlements, :final transactionId):
          // Fire-and-forget billing handoff. It returns void, is never awaited,
          // and its outcome never reaches onInteraction or onResult: an
          // observation triggers server-side validation and is never proof.
          // A host-supplied sink that throws must not become a failed purchase.
          try {
            widget.transactionObservations?.observePurchaseResult(
              transactionReference: transactionId,
            );
          } on Object {
            // Deliberately swallowed: this is the one failure that must never
            // alter a purchase outcome. The subsystem records its own safe
            // diagnostic code.
          }
          _analytics(
            MosaicAnalyticsEventName.purchaseCompletedClient,
            correlation: widget.analyticsContext?.correlation(
              purchaseAttemptId: analyticsAttemptId,
            ),
            attribution: analyticsAttribution,
            payload: <String, Object?>{
              'outcome': 'purchased',
              'durationMs': _analyticsDuration(analyticsStartedAt),
              'observedEntitlementKeys': activeEntitlements
                  .map((item) => item.id)
                  .take(64)
                  .toList(growable: false),
            },
          );
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
        case MosaicAlreadyEntitled(:final activeEntitlements):
          _analytics(
            MosaicAnalyticsEventName.purchaseCompletedClient,
            correlation: widget.analyticsContext?.correlation(
              purchaseAttemptId: analyticsAttemptId,
            ),
            attribution: analyticsAttribution,
            payload: <String, Object?>{
              'outcome': 'already_entitled',
              'durationMs': _analyticsDuration(analyticsStartedAt),
              'observedEntitlementKeys': activeEntitlements
                  .map((item) => item.id)
                  .take(64)
                  .toList(growable: false),
            },
          );
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
          _purchaseLifecycleAnalytics(
              MosaicAnalyticsEventName.purchaseCancelled,
              analyticsAttemptId,
              analyticsStartedAt,
              analyticsAttribution,
              providerResultCode: 'commerce.purchase_cancelled');
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
          _purchaseLifecycleAnalytics(MosaicAnalyticsEventName.purchasePending,
              analyticsAttemptId, analyticsStartedAt, analyticsAttribution);
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
          _purchaseLifecycleAnalytics(MosaicAnalyticsEventName.purchaseDeferred,
              analyticsAttemptId, analyticsStartedAt, analyticsAttribution);
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
          _analytics(
            MosaicAnalyticsEventName.productUnavailable,
            attribution: analyticsAttribution,
            payload: const {'reason': 'product_not_found'},
          );
          _notifyProductUnavailable(selectorId, referenceId: referenceId);
        case MosaicPurchaseProviderUnavailable():
          _purchaseFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
              analyticsAttribution, 'commerce.provider_unavailable', true);
          _reportPurchaseFailure(
            selectorId: selectorId,
            referenceId: referenceId,
            diagnosticCode: 'purchase_provider_unavailable',
          );
        case MosaicPurchaseConfigurationUnavailable():
          _purchaseFailureAnalytics(
              analyticsAttemptId,
              analyticsStartedAt,
              analyticsAttribution,
              'commerce.configuration_unavailable',
              false);
          widget.onResult(
            const MosaicConfigurationUnavailablePresentationResult(
              diagnosticCode: 'commerce_configuration_unavailable',
            ),
          );
        case MosaicPurchaseFailed():
          _purchaseFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
              analyticsAttribution, 'commerce.purchase_failed', false);
          _reportPurchaseFailure(
            selectorId: selectorId,
            referenceId: referenceId,
            diagnosticCode: 'purchase_provider_failed',
          );
      }
    } on Object {
      _purchaseFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
          analyticsAttribution, 'commerce.purchase_exception', true);
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
    final analyticsAttemptId = mosaicAnalyticsId('restore_attempt');
    final analyticsStartedAt = widget.clock().toUtc();
    final providerId = widget.analyticsContext?.providerId;
    _analytics(MosaicAnalyticsEventName.paywallActionSelected,
        payload: <String, Object?>{
          'action': 'restore',
          'componentId': buttonId
        });
    if (providerId != null) {
      _analytics(
        MosaicAnalyticsEventName.restoreStarted,
        correlation: widget.analyticsContext?.correlation(
          restoreAttemptId: analyticsAttemptId,
        ),
        payload: <String, Object?>{'providerId': providerId},
      );
    }
    try {
      final result = await widget.purchaseProvider.restore();
      if (!mounted) {
        return;
      }
      switch (result) {
        case MosaicRestored():
          _restoreCompletedAnalytics(analyticsAttemptId, analyticsStartedAt,
              providerId, result.entitlements);
          final references = _referenceIds(result.entitlements);
          widget.onInteraction?.call(
            const MosaicInteraction(
              outcome: MosaicInteractionOutcome.restored,
            ),
          );
          widget.onResult(MosaicRestoredPresentationResult(references));
        case MosaicNothingToRestore():
          _restoreLifecycleAnalytics(
              MosaicAnalyticsEventName.restoreNothingFound,
              analyticsAttemptId,
              analyticsStartedAt,
              providerId);
          widget.onInteraction?.call(
            const MosaicInteraction(
              outcome: MosaicInteractionOutcome.restoreNoPurchases,
            ),
          );
        case MosaicRestoreCancelled():
          _restoreLifecycleAnalytics(MosaicAnalyticsEventName.restoreCancelled,
              analyticsAttemptId, analyticsStartedAt, providerId);
          widget.onInteraction?.call(
            const MosaicInteraction(
              outcome: MosaicInteractionOutcome.restoreCancelled,
            ),
          );
        case MosaicRestoreProviderUnavailable():
          _restoreFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
              providerId, 'commerce.provider_unavailable', true);
          _reportRestoreFailure('restore_provider_unavailable');
        case MosaicRestoreConfigurationUnavailable():
          _restoreFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
              providerId, 'commerce.configuration_unavailable', false);
          widget.onResult(
            const MosaicConfigurationUnavailablePresentationResult(
              diagnosticCode: 'commerce_configuration_unavailable',
            ),
          );
        case MosaicRestoreFailed():
          _restoreFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
              providerId, 'commerce.restore_failed', false);
          _reportRestoreFailure('restore_provider_failed');
        case MosaicDetailedRestoreResult():
          switch (result.outcome) {
            case MosaicCommerceRecoveryOutcome.restored:
              _restoreCompletedAnalytics(analyticsAttemptId, analyticsStartedAt,
                  providerId, result.entitlements,
                  providerOperationId: result.metadata.operationId);
              final references = _referenceIds(result.entitlements);
              widget.onInteraction?.call(
                const MosaicInteraction(
                    outcome: MosaicInteractionOutcome.restored),
              );
              widget.onResult(MosaicRestoredPresentationResult(references));
            case MosaicCommerceRecoveryOutcome.nothingToRestore:
              _restoreLifecycleAnalytics(
                  MosaicAnalyticsEventName.restoreNothingFound,
                  analyticsAttemptId,
                  analyticsStartedAt,
                  providerId);
              widget.onInteraction?.call(
                const MosaicInteraction(
                  outcome: MosaicInteractionOutcome.restoreNoPurchases,
                ),
              );
            case MosaicCommerceRecoveryOutcome.cancelled:
              _restoreLifecycleAnalytics(
                  MosaicAnalyticsEventName.restoreCancelled,
                  analyticsAttemptId,
                  analyticsStartedAt,
                  providerId);
              widget.onInteraction?.call(
                const MosaicInteraction(
                  outcome: MosaicInteractionOutcome.restoreCancelled,
                ),
              );
            case MosaicCommerceRecoveryOutcome.providerUnavailable:
              _restoreFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
                  providerId, 'commerce.provider_unavailable', true);
              _reportRestoreFailure('restore_provider_unavailable');
            case MosaicCommerceRecoveryOutcome.failed:
              _restoreFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
                  providerId, 'commerce.restore_failed', false);
              _reportRestoreFailure('restore_provider_failed');
          }
      }
    } on Object {
      _restoreFailureAnalytics(analyticsAttemptId, analyticsStartedAt,
          providerId, 'commerce.restore_exception', true);
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
    _analytics(MosaicAnalyticsEventName.paywallActionSelected,
        payload: const <String, Object?>{'action': 'close'});
    _analytics(MosaicAnalyticsEventName.paywallDismissed,
        payload: const <String, Object?>{'reason': 'user'});
    widget.onResult(const MosaicDismissedPresentationResult());
  }

  int _analyticsDuration(DateTime startedAt) => widget
      .clock()
      .toUtc()
      .difference(startedAt)
      .inMilliseconds
      .clamp(0, 86400000);

  void _purchaseLifecycleAnalytics(
      MosaicAnalyticsEventName name,
      String attemptId,
      DateTime startedAt,
      MosaicAnalyticsAttribution? attribution,
      {String? providerResultCode}) {
    _analytics(name,
        correlation:
            widget.analyticsContext?.correlation(purchaseAttemptId: attemptId),
        attribution: attribution,
        payload: <String, Object?>{
          'durationMs': _analyticsDuration(startedAt),
          if (providerResultCode != null)
            'providerResultCode': providerResultCode,
        });
  }

  void _purchaseFailureAnalytics(String attemptId, DateTime startedAt,
      MosaicAnalyticsAttribution? attribution, String code, bool retryable) {
    _analytics(MosaicAnalyticsEventName.purchaseFailed,
        correlation:
            widget.analyticsContext?.correlation(purchaseAttemptId: attemptId),
        attribution: attribution,
        payload: <String, Object?>{
          'durationMs': _analyticsDuration(startedAt),
          'diagnosticCode': code,
          'retryable': retryable,
        });
  }

  void _restoreCompletedAnalytics(String attemptId, DateTime startedAt,
      String? providerId, Set<MosaicEntitlement> entitlements,
      {String? providerOperationId}) {
    if (providerId == null) return;
    final ids = entitlements.map((e) => e.id).take(64).toList(growable: false);
    _analytics(MosaicAnalyticsEventName.restoreCompleted,
        correlation: widget.analyticsContext?.correlation(
          restoreAttemptId: attemptId,
          providerOperationId: providerOperationId,
        ),
        payload: <String, Object?>{
          'providerId': providerId,
          'durationMs': _analyticsDuration(startedAt),
          'restoredProductIds': const <String>[],
          'observedEntitlementKeys': ids,
        });
  }

  void _restoreLifecycleAnalytics(MosaicAnalyticsEventName name,
      String attemptId, DateTime startedAt, String? providerId) {
    if (providerId == null) return;
    _analytics(name,
        correlation:
            widget.analyticsContext?.correlation(restoreAttemptId: attemptId),
        payload: <String, Object?>{
          'providerId': providerId,
          'durationMs': _analyticsDuration(startedAt),
        });
  }

  void _restoreFailureAnalytics(String attemptId, DateTime startedAt,
      String? providerId, String code, bool retryable) {
    if (providerId == null) return;
    _analytics(MosaicAnalyticsEventName.restoreFailed,
        correlation:
            widget.analyticsContext?.correlation(restoreAttemptId: attemptId),
        payload: <String, Object?>{
          'providerId': providerId,
          'durationMs': _analyticsDuration(startedAt),
          'diagnosticCode': code,
          'retryable': retryable,
        });
  }

  void _navigateTo(MosaicNavigateToAction action) {
    if (_currentScreenId == null || action.screenId == _currentScreenId) return;
    _analytics(MosaicAnalyticsEventName.paywallActionSelected,
        payload: const <String, Object?>{'action': 'navigate_to'});
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
    _analytics(MosaicAnalyticsEventName.paywallActionSelected,
        payload: const <String, Object?>{'action': 'navigate_back'});
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
    _analytics(MosaicAnalyticsEventName.paywallActionSelected,
        payload: <String, Object?>{
          'action': 'open_external_url',
          'componentId': buttonId,
        });
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
