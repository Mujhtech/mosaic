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
    // Motion sits inside visibility: a hidden node is out of layout, the
    // accessibility tree, and focus order, and there is nothing to animate.
    result = _applyNodeMotion(node, result);
    return Visibility(
      key: ValueKey<String>('mosaic-visibility-${node.id}'),
      visible: _visibilityIsVisible(visibility),
      maintainState: true,
      maintainAnimation: true,
      child: result,
    );
  }

  /// The selection transition [node] authored, with its curve resolved.
  ///
  /// Only Product Selector and Tabs can carry one: they are the two components
  /// that own runtime selection state.
  MosaicSelectionMotion? _selectionMotionFor(MosaicNode node) {
    final selection = node.motion?.selection;
    if (selection == null) return null;
    return widget.document.resolveNodeMotion(node.motion!).selection;
  }

  /// Wraps [child] in the entrance and pulse a node authored, if any.
  ///
  /// Both scopes collapse to [child] itself once their terminal frame is
  /// reached, so a finished animation leaves no residue in the tree to diverge
  /// from what a motion-less renderer draws.
  Widget _applyNodeMotion(MosaicNode node, Widget child) {
    final motion = node.motion;
    if (motion == null) return child;
    final resolved = widget.document.resolveNodeMotion(motion);
    var result = child;
    final screenEntryCount = _screenEntryCountFor(node);
    if (resolved.loop case final loop?) {
      result = MosaicLoopMotionScope(
        key: ValueKey<String>('mosaic-loop-${node.id}'),
        driver: widget.motionDriver,
        motion: loop,
        reducedMotion: _reducedMotion,
        screenEntryCount: screenEntryCount,
        child: result,
      );
    }
    // The entrance wraps the pulse: a node fades in as a whole, pulse included,
    // rather than the pulse compounding a second entrance opacity.
    if (resolved.appear case final appear?) {
      result = MosaicAppearMotionScope(
        key: ValueKey<String>('mosaic-appear-${node.id}'),
        driver: widget.motionDriver,
        motion: appear,
        reducedMotion: _reducedMotion,
        screenEntryCount: screenEntryCount,
        child: result,
      );
    }
    return result;
  }

  /// How many times the screen holding [node] has been entered.
  ///
  /// A node outside every screen — the legacy single-layout projection — has no
  /// screen to be entered, so it holds the paywall's own presentation as its
  /// one entry.
  int _screenEntryCountFor(MosaicNode node) {
    final screenId = _screenIdByNodeId[node.id];
    if (screenId == null) return 1;
    return _screenEntryCounts[screenId] ?? 0;
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
    // Protocol 0.4 ruling: under reduced motion a video background does not
    // play. The declared poster is rendered if it is available and the declared
    // fallback colour otherwise — the same resolution order the existing
    // missing-media policy already uses, deliberately, so this reuses a path
    // three renderers have implemented rather than adding a fourth outcome.
    // No frame of the video is shown, playback is never started and paused,
    // and no control is offered. 0.3 documents keep 0.3's behaviour: the
    // ruling ships as specified 0.4 behaviour, not as a 0.3 defect patch.
    final videoAsset = widget.document.videoAsset(video.assetId)!;
    if (_reducedMotion &&
        widget.document.schemaVersion == mosaicProtocolVersionV04) {
      // Availability and playability are decided independently. Whether the
      // media exists is a fact about the document and the host's asset
      // resolution; whether it plays is a fact about the customer's settings.
      // An operator debugging a 0.4 paywall on a reduced-motion device must
      // still be told the video could not be resolved, so the same diagnostic
      // the playing path would raise is raised here — and the converse holds
      // too: a resolvable video that is deliberately not played is not a broken
      // paywall and diagnoses nothing.
      if (!_videoSourceIsResolvable(videoAsset)) {
        _notifyMediaFailure(
          video.assetId,
          'background.videoUnavailable',
          _videoUnavailableMessage(hasPoster: poster != null),
        );
      }
      return _staticVideoSubstitute(context, video, poster);
    }
    return MosaicDecorativeVideo(
      key: ValueKey<String>('mosaic-background-video-${video.assetId}'),
      asset: videoAsset,
      bundledResolver: widget.videoResolver,
      poster: poster,
      fallbackColor: _color(context, video.fallbackColor),
      fit: video.contentMode == MosaicImageContentMode.fit
          ? BoxFit.contain
          : BoxFit.cover,
      onUnavailable: () => _notifyMediaFailure(
        video.assetId,
        'background.videoUnavailable',
        _videoUnavailableMessage(hasPoster: poster != null),
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

  /// Whether the video's own source resolves, independently of whether
  /// anything intends to play it.
  ///
  /// A bundled key the host cannot map to an asset path is missing media, and
  /// that is knowable without constructing a player — which is what lets the
  /// suppressed path answer it at all. A remote source is reported as
  /// resolvable because its reachability is only knowable by fetching it, and
  /// fetching is the playback the reduced-motion ruling forbids. A remote
  /// video that would have failed to load is therefore diagnosed on the
  /// playing path and not on the suppressed one, which is the honest answer:
  /// nothing observed it fail.
  bool _videoSourceIsResolvable(MosaicVideoAsset asset) =>
      switch (asset.source) {
        MosaicBundledAssetSource(:final key) =>
          widget.videoResolver?.call(key) != null,
        MosaicRemoteAssetSource() => true,
      };

  /// The one wording both the playing and the suppressed path report, so an
  /// operator cannot tell from the diagnostic which decision was taken — only
  /// that the media could not be resolved.
  String _videoUnavailableMessage({required bool hasPoster}) => hasPoster
      ? 'Video background is unavailable; its poster is used.'
      : 'Video background is unavailable; its fallback colour is used.';

  /// What a video background draws when reduced motion forbids playing it.
  ///
  /// A video authored with no poster degrades to its fallback colour. The
  /// protocol does not make a poster mandatory, because a colour is a
  /// legitimate answer and a required-but-ignorable field is worse than an
  /// optional one.
  Widget _staticVideoSubstitute(
    BuildContext context,
    MosaicVideoBackground video,
    ImageProvider<Object>? poster,
  ) {
    final fallbackColor = _color(context, video.fallbackColor);
    return ExcludeSemantics(
      key: ValueKey<String>('mosaic-reduced-motion-video-${video.assetId}'),
      child: ColoredBox(
        color: fallbackColor,
        child: poster == null
            ? const SizedBox.expand()
            : Image(
                image: poster,
                fit: video.contentMode == MosaicImageContentMode.fit
                    ? BoxFit.contain
                    : BoxFit.cover,
                excludeFromSemantics: true,
                errorBuilder: (context, error, stackTrace) {
                  _notifyMediaFailure(
                    video.posterAssetId ?? video.assetId,
                    'background.imageUnavailable',
                    'Video poster is unavailable; the fallback colour is used.',
                  );
                  return const SizedBox.expand();
                },
              ),
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

  /// Resolves [visibility] against the runtime selection this renderer holds.
  ///
  /// `_resetRuntimeState` seeds every Switch and Tabs controller the document
  /// declares, so the throwing contract of [evaluateMosaicVisibility] cannot
  /// fire for a validated document. It is deliberately not caught here: a
  /// controller missing from the state is an SDK bug, and swallowing it would
  /// turn that bug into a component that quietly vanishes.
  bool _visibilityIsVisible(MosaicVisibility visibility) =>
      evaluateMosaicVisibility(visibility, _selectionState);

  bool _isNodeEffectivelyVisible(String targetId) {
    bool? visit(MosaicNode node, bool ancestorsVisible) {
      final nodeVisible = ancestorsVisible &&
          _visibilityIsVisible(switch (node) {
            MosaicStackComponent() => node.visibility,
            MosaicTextComponent() => node.visibility,
            MosaicImageComponent() => node.visibility,
            MosaicFeatureListComponent() => node.visibility,
            MosaicProductSelectorComponent() => node.visibility,
            MosaicCarouselComponent() => node.visibility,
            MosaicSwitchComponent() => node.visibility,
            MosaicCountdownComponent() => node.visibility,
            MosaicButtonComponent() => node.visibility,
            MosaicIconComponent() => node.visibility,
            MosaicTabsComponent() => node.visibility,
            MosaicTimelineComponent() => node.visibility,
            MosaicAwardComponent() => node.visibility,
            MosaicSocialProofComponent() => node.visibility,
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
      } else if (node is MosaicTabsComponent) {
        // Only the selected panel is in the layout, the accessibility tree,
        // and focus order, so a target inside any other panel is not visible.
        for (final tab in node.tabs) {
          final result = visit(
            tab.content,
            nodeVisible && _tabSelections[node.id] == tab.id,
          );
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
    // Authored typography is never dropped because the Material theme happens
    // to leave the mapped style null: fall back to an empty base so every
    // authored value below still reaches the Text widget.
    return (base ?? const TextStyle()).copyWith(
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
      // Unreachable while the decoder rejects unknown semantic colours, so a
      // value arriving here means the semantic palette grew without this map.
      // Transparent stays as the last resort, but it is never silent: an
      // invisible surface must be attributable to a named token.
      _ => _unknownSemanticColor(value.value),
    };
  }

  Color _unknownSemanticColor(String token) {
    _notifyUnknownColorToken(token);
    return Colors.transparent;
  }

  /// The composed announcement contract for [node].
  ///
  /// Segments are never joined here: the contract returns each as its own
  /// element and the platform supplies whatever pause or punctuation its locale
  /// and screen reader use.
  MosaicAccessibilityAnnouncement _announcementFor(
    MosaicNode node, {
    MosaicButtonAnnouncementState? state,
  }) =>
      mosaicAccessibilityAnnouncement(
        node,
        strings: _localization.catalogStrings,
        state: state,
      );

  void _notifyUnknownColorToken(String token) {
    if (!_notifiedUnknownColorTokens.add(token)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      widget.onDiagnostic?.call(
        MosaicDiagnostic(
          code: 'style.unknownColorToken',
          message: 'Colour "$token" is not supported by this renderer; a '
              'transparent last resort is used.',
          severity: MosaicDiagnosticSeverity.error,
        ),
      );
    });
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
