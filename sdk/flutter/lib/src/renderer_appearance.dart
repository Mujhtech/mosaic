part of 'renderer.dart';

extension on _MosaicPaywallState {
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
