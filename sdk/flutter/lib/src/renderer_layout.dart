part of 'renderer.dart';

extension on _MosaicPaywallState {
  Widget _buildStack(
    BuildContext context,
    MosaicStackComponent stack, {
    _AvailableProductOption? productOption,
  }) {
    final horizontal = stack.direction == MosaicStackDirection.horizontal;
    final children = <Widget>[];
    for (var index = 0; index < stack.children.length; index += 1) {
      if (index > 0 && stack.gap > 0) {
        children.add(
          horizontal ? SizedBox(width: stack.gap) : SizedBox(height: stack.gap),
        );
      }
      final child = _buildNode(
        context,
        stack.children[index],
        productOption: productOption,
      );
      children.add(horizontal ? Flexible(child: child) : child);
    }
    final Widget stackWidget;
    if (horizontal) {
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
      stackWidget = Column(
        mainAxisSize: stack.sizing?.height.mode == MosaicSizingMode.fixed
            ? MainAxisSize.max
            : MainAxisSize.min,
        mainAxisAlignment: _mainAxisAlignment(stack.mainAxisDistribution),
        crossAxisAlignment: _crossAxisAlignment(stack.crossAxisAlignment),
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
    return _decorateNode(
      context,
      stack,
      padded,
      appearance: stack.appearance,
      sizing: stack.sizing,
      outerInsets: stack.outerInsets,
      visibility: stack.visibility,
    );
  }

  Widget _buildNode(
    BuildContext context,
    MosaicNode node, {
    _AvailableProductOption? productOption,
  }) {
    final content = switch (node) {
      MosaicStackComponent() =>
        _buildStack(context, node, productOption: productOption),
      MosaicTextComponent() =>
        _buildText(context, node, productOption: productOption),
      MosaicImageComponent() => _buildImage(context, node),
      MosaicFeatureListComponent() => _buildFeatureList(context, node),
      MosaicProductSelectorComponent() => _buildProductSelector(context, node),
      MosaicCarouselComponent() => _buildCarousel(context, node),
      MosaicSwitchComponent() => _buildSwitch(context, node),
      MosaicCountdownComponent() => _buildCountdown(context, node),
      MosaicButtonComponent() => _buildButton(context, node),
      MosaicIconComponent() => _buildIcon(context, node),
      MosaicTabsComponent() => _buildTabs(context, node),
      MosaicTimelineComponent() => _buildTimeline(context, node),
      MosaicAwardComponent() => _buildAward(context, node),
      MosaicSocialProofComponent() => _buildSocialProof(context, node),
      // A Product Card or Product Badge only renders through its owning Product
      // Selector, and a Scroll Container only exists as a Screen root. Reaching
      // any of them here means the node is authored in a position this renderer
      // cannot draw, so it collapses — but never silently.
      MosaicProductCardComponent() ||
      MosaicProductBadgeComponent() ||
      MosaicScrollContainer() =>
        _unrenderableNode(node),
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
      MosaicTabsComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicTimelineComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicAwardComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      MosaicSocialProofComponent() => _decorateNode(
          context,
          node,
          content,
          appearance: node.appearance,
          sizing: node.sizing,
          outerInsets: node.outerInsets,
          visibility: node.visibility,
        ),
      // Product Cards and Product Badges carry authored sizing but style
      // themselves through their state-aware styles, which the Product Selector
      // path applies. Both already collapsed above, so there is nothing left to
      // decorate. Enumerated rather than matched by a wildcard so a new node
      // type cannot silently lose its authored appearance, sizing, outer
      // insets, or visibility.
      MosaicProductCardComponent() || MosaicProductBadgeComponent() => content,
      // Handled by the early return above.
      MosaicStackComponent() || MosaicScrollContainer() => content,
    };
  }

  Widget _unrenderableNode(
    MosaicNode node, {
    String code = 'rendering.unsupportedNodePlacement',
    String? message,
  }) {
    if (_notifiedUnrenderableNodes.add(node.id)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        widget.onDiagnostic?.call(
          MosaicDiagnostic(
            code: code,
            message: message ??
                '${node.type} ${node.id} cannot be rendered in this '
                    'position and is omitted.',
            severity: MosaicDiagnosticSeverity.error,
          ),
        );
      });
    }
    return const SizedBox.shrink();
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
        final scrollHorizontally =
            component.direction == MosaicProductSelectorDirection.horizontal &&
                MediaQuery.textScalerOf(context).scale(1) > 1.3;
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
          final rendered = _buildProductCard(
            context,
            component,
            option,
            shrinkWrap: scrollHorizontally,
          );
          renderedOptions.add(
            component.direction == MosaicProductSelectorDirection.horizontal &&
                    !scrollHorizontally
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
            : _horizontalSelector(
                component,
                renderedOptions,
                scrollHorizontally: scrollHorizontally,
              );
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
    List<Widget> children, {
    required bool scrollHorizontally,
  }) {
    final row = Row(
      mainAxisSize: scrollHorizontally ? MainAxisSize.min : MainAxisSize.max,
      crossAxisAlignment: _crossAxisAlignment(selector.crossAxisAlignment),
      children: children,
    );
    final content =
        selector.crossAxisAlignment == MosaicStackHorizontalAlignment.stretch
            ? IntrinsicHeight(child: row)
            : row;
    return scrollHorizontally
        ? SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: content,
          )
        : content;
  }

  Widget _buildProductCard(
    BuildContext context,
    MosaicProductSelectorComponent selector,
    _AvailableProductOption option, {
    required bool shrinkWrap,
  }) {
    final card = option.card;
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
      // Horizontal selectors measure cards on an unbounded main axis. Their
      // authored horizontal content must shrink-wrap instead of introducing
      // Flexible children into that unbounded Row.
      shrinkWrap: shrinkWrap,
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
}
