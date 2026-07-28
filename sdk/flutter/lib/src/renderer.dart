import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import 'analytics.dart';
import 'analytics_event.dart';
import 'commerce.dart';
import 'configuration.dart';
import 'localization.dart';
import 'presentation.dart';
import 'protocol.dart';
import 'transaction_observation.dart';

part 'renderer_actions.dart';
part 'renderer_layout.dart';
part 'renderer_components.dart';
part 'renderer_appearance.dart';

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

Future<bool> mosaicExternalUrlOpener(Uri url) => launchUrl(
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
    this.externalUrlOpener = mosaicExternalUrlOpener,
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
    this.analyticsRuntime,
    this.analyticsContext,
    this.transactionObservations,
    this.onPresented,
    this.clock = _mosaicSystemClock,
    this.externalUrlOpener = mosaicExternalUrlOpener,
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
  final MosaicAnalyticsRuntime? analyticsRuntime;
  final MosaicAnalyticsPresentationContext? analyticsContext;

  /// Optional billing handoff. It is fire-and-forget by construction: the sink
  /// returns `void`, so the purchase flow can never await, block on, or be
  /// altered by it, and it never re-labels a local purchase result.
  final MosaicTransactionObservationSink? transactionObservations;
  final VoidCallback? onPresented;
  final MosaicClock clock;
  final MosaicExternalUrlOpener externalUrlOpener;

  @override
  State<MosaicPaywall> createState() => _MosaicPaywallState();
}

final class _MosaicPaywallState extends State<MosaicPaywall> {
  void _setPaywallState(VoidCallback update) => setState(update);

  final ScrollController _scrollController = ScrollController();
  final Map<String, MosaicProduct> _availableProducts =
      <String, MosaicProduct>{};
  final Map<String, String?> _selectedProductCardIds = <String, String?>{};
  final Set<String> _notifiedUnavailableSelectors = <String>{};
  final Set<String> _notifiedHiddenPurchaseTargets = <String>{};
  final Set<String> _notifiedMediaFailures = <String>{};
  final Set<String> _notifiedUnboundedFill = <String>{};
  final Set<String> _reportedRenderingFailures = <String>{};
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
  String? _productLoadAttemptId;

  @override
  void initState() {
    super.initState();
    _resolveLocalization();
    _resetRuntimeState();
    _resetNavigationState();
    _configureCountdownTimer();
    unawaited(_loadProducts());
    _analytics(
      MosaicAnalyticsEventName.paywallPresented,
      correlation: widget.analyticsContext?.correlation(),
      attribution: widget.analyticsContext?.attribution,
      payload: const {},
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onPresented?.call();
    });
  }

  void _analytics(
    MosaicAnalyticsEventName name, {
    MosaicAnalyticsCorrelation? correlation,
    MosaicAnalyticsAttribution? attribution,
    required Map<String, Object?> payload,
  }) {
    final runtime = widget.analyticsRuntime;
    if (runtime == null || widget.analyticsContext == null) return;
    unawaited(runtime
        .record(
          name: name,
          correlation: correlation ?? widget.analyticsContext!.correlation(),
          attribution: attribution ?? widget.analyticsContext!.attribution,
          payload: payload,
        )
        .catchError((Object _) => false));
  }

  void _reportRenderingFailure(String diagnosticCode) {
    if (!_reportedRenderingFailures.add(diagnosticCode)) return;
    _analytics(
      MosaicAnalyticsEventName.paywallRenderFailed,
      payload: const <String, Object?>{
        'diagnosticCode': 'rendering.failed',
        'retryable': false,
      },
    );
    widget.onDiagnostic?.call(
      MosaicDiagnostic(
        code: diagnosticCode,
        message: 'The Mosaic paywall could not be rendered safely.',
        severity: MosaicDiagnosticSeverity.error,
      ),
    );
    widget.onResult(
      MosaicRenderingFailedPresentationResult(
        diagnosticCode: diagnosticCode,
      ),
    );
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
