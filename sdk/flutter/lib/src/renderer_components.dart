part of 'renderer.dart';

extension on _MosaicPaywallState {
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
    MosaicSelectionMotion? selectionMotion,
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
              selectionMotion: selectionMotion,
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
      final column = Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: _mainAxisAlignment(mainAxisDistribution),
        crossAxisAlignment: _crossAxisAlignment(crossAxisAlignment),
        children: rendered,
      );
      // A horizontal selector gives each fit-width card an unbounded width
      // while measuring it. IntrinsicWidth establishes that card's finite
      // content width before a vertical authored layout applies `stretch`.
      return shrinkWrap &&
              crossAxisAlignment == MosaicStackHorizontalAlignment.stretch
          ? IntrinsicWidth(child: column)
          : column;
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

  /// A Product Badge is the Product Card's second two-state selectable box, so
  /// it follows the same selection transition its Selector authored.
  Widget _buildProductBadge(
    BuildContext context,
    MosaicProductBadgeComponent badge, {
    required _AvailableProductOption option,
    required bool selected,
    MosaicSelectionMotion? selectionMotion,
  }) {
    Widget surface(BuildContext context, MosaicSelectionStateStyle style) =>
        _buildProductBadgeSurface(
          context,
          badge,
          style: style,
          option: option,
          selected: selected,
          selectionMotion: selectionMotion,
        );
    final rendered = selectionMotion == null
        ? surface(context, badge.styles.resolve(selected: selected))
        : MosaicSelectionMotionScope(
            key: ValueKey<String>('mosaic-selection-${badge.id}'),
            driver: widget.motionDriver,
            motion: selectionMotion,
            reducedMotion: _reducedMotion,
            selected: selected,
            styles: badge.styles,
            builder: surface,
          );
    return _applyNodeMotion(
      badge,
      _applySizing(badge, rendered, badge.sizing),
    );
  }

  Widget _buildProductBadgeSurface(
    BuildContext context,
    MosaicProductBadgeComponent badge, {
    required MosaicSelectionStateStyle style,
    required _AvailableProductOption option,
    required bool selected,
    required MosaicSelectionMotion? selectionMotion,
  }) {
    final content = _buildAuthoredProductLayout(
      context,
      direction: badge.direction,
      gap: badge.gap,
      mainAxisDistribution: badge.mainAxisDistribution,
      crossAxisAlignment: badge.crossAxisAlignment,
      children: badge.children,
      option: option,
      selected: selected,
      selectionMotion: selectionMotion,
      shrinkWrap: badge.placement is MosaicOverlayProductBadgePlacement,
    );
    return Opacity(
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
    // One control, one accessibility element. The authored name does not
    // change when the Button becomes busy — a name that changes mid-operation
    // is disorienting and breaks UI automation — so busy-ness is carried as
    // the value. Neither idle nor in-progress content is announced, in both
    // states alike, so the subtree stays excluded.
    final announcement = _announcementFor(
      component,
      state: busy
          ? MosaicButtonAnnouncementState.inProgress
          : MosaicButtonAnnouncementState.idle,
    );
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      button: true,
      enabled: enabled,
      liveRegion: busy,
      explicitChildNodes: true,
      label: announcement.container.label,
      hint: announcement.container.hint,
      value: announcement.container.value,
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

  Widget _buildIcon(BuildContext context, MosaicIconComponent component) {
    final icon = Icon(
      _materialIcon(component.name),
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
        _setPaywallState(() {
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
                _setPaywallState(() {
                  _switchValues[component.id] = next;
                });
              },
            ),
          ],
        ),
      ),
    );
  }

  /// Countdown, rebuilt on its own one-second tick rather than on the
  /// document's.
  Widget _buildCountdown(
    BuildContext context,
    MosaicCountdownComponent component,
  ) =>
      MosaicTickBuilder(
        ticks: _countdownTicks,
        builder: (context) => _buildCountdownFrame(context, component),
      );

  Widget _buildCountdownFrame(
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
}
