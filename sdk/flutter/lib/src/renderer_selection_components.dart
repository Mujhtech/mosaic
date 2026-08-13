part of 'renderer.dart';

/// Tabs, Timeline, Award, and Social Proof.
///
/// Tabs is the only one of the four that owns runtime state; the other three
/// are passive and read nothing but their authored content.
extension on _MosaicPaywallState {
  Widget _buildTabs(BuildContext context, MosaicTabsComponent component) {
    final selectedId = _tabSelections[component.id];
    final selected = selectedId == null ? null : component.tab(selectedId);
    if (selected == null) {
      // `_resetRuntimeState` seeds every Tabs component from its authored
      // `initialTabId`, and the decoder guarantees that id names a declared
      // tab. Arriving here means runtime state and document disagree, which is
      // an SDK bug: it must never be papered over by quietly opening the first
      // panel, because that reads back as a working paywall.
      return _unrenderableNode(
        component,
        code: 'rendering.tabSelectionUnresolved',
        message: 'Tabs ${component.id} has no resolvable selected tab; the '
            'component is omitted.',
      );
    }

    final controls = <Widget>[];
    for (var index = 0; index < component.tabs.length; index += 1) {
      if (index > 0 && component.tabBarGap > 0) {
        controls.add(
          component.tabBarDirection == MosaicStackDirection.horizontal
              ? SizedBox(width: component.tabBarGap)
              : SizedBox(height: component.tabBarGap),
        );
      }
      controls.add(_buildTabControl(context, component, component.tabs[index]));
    }

    final bar = component.tabBarDirection == MosaicStackDirection.horizontal
        ? IntrinsicHeight(
            child: Row(
              mainAxisSize: MainAxisSize.max,
              mainAxisAlignment:
                  _mainAxisAlignment(component.tabBarDistribution),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: controls,
            ),
          )
        : Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: _mainAxisAlignment(component.tabBarDistribution),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: controls,
          );

    final panelLabel = _localization.text(selected.label);
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
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          bar,
          if (component.gap > 0) SizedBox(height: component.gap),
          // The panel carries the same authored label as its control, so the
          // two names cannot drift apart.
          Semantics(
            key: ValueKey<String>('mosaic-${component.id}-panel'),
            container: true,
            explicitChildNodes: true,
            label: panelLabel,
            child: _buildStack(context, selected.content),
          ),
        ],
      ),
    );
  }

  /// Tabs `selection` animates the tab control's style, not the panel swap.
  ///
  /// Visibility semantics remove a hidden node from layout, the
  /// accessibility tree, and focus order; animating that removal would need a
  /// "present but not focusable" third state the protocol does not have.
  Widget _buildTabControl(
    BuildContext context,
    MosaicTabsComponent component,
    MosaicTabsEntry tab,
  ) {
    final isSelected = _tabSelections[component.id] == tab.id;
    final selectionMotion = _selectionMotionFor(component);
    if (selectionMotion == null) {
      return _buildTabControlSurface(
        context,
        component,
        tab,
        style: component.styles.resolve(selected: isSelected),
        isSelected: isSelected,
      );
    }
    return MosaicSelectionMotionScope(
      key: ValueKey<String>('mosaic-selection-${component.id}-${tab.id}'),
      driver: widget.motionDriver,
      motion: selectionMotion,
      reducedMotion: _reducedMotion,
      selected: isSelected,
      styles: component.styles,
      builder: (context, style) => _buildTabControlSurface(
        context,
        component,
        tab,
        style: style,
        isSelected: isSelected,
      ),
    );
  }

  Widget _buildTabControlSurface(
    BuildContext context,
    MosaicTabsComponent component,
    MosaicTabsEntry tab, {
    required MosaicSelectionStateStyle style,
    required bool isSelected,
  }) {
    final label = _localization.text(tab.label);
    final baseStyle = _textStyle(
      context,
      component.labelTypography,
      component.labelTypography.style,
    );
    final control = Opacity(
      opacity: style.opacity,
      child: _decorateSurface(
        context,
        background: style.background,
        border: style.border,
        cornerRadius: style.cornerRadius,
        shadow: style.shadow,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
          child: Padding(
            padding: _edgeInsets(style.padding),
            child: Center(
              widthFactor: 1,
              child: Text(
                label,
                style: isSelected
                    ? (baseStyle ?? const TextStyle()).copyWith(
                        color: _color(context, component.selectedLabelColor),
                      )
                    : baseStyle,
                textAlign: _textAlign(component.labelTypography.alignment),
              ),
            ),
          ),
        ),
      ),
    );
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}-${tab.id}'),
      button: true,
      selected: isSelected,
      inMutuallyExclusiveGroup: true,
      enabled: true,
      label: label,
      child: ExcludeSemantics(
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(style.cornerRadius),
            onTap: isSelected ? null : () => _selectTab(component, tab.id),
            child: control,
          ),
        ),
      ),
    );
  }

  void _selectTab(MosaicTabsComponent component, String tabId) {
    _setPaywallState(() {
      _tabSelections[component.id] = tabId;
    });
  }

  Widget _buildTimeline(
    BuildContext context,
    MosaicTimelineComponent component,
  ) {
    final announcement = _announcementFor(component);
    final markerExtent = component.markerSize ?? 0;
    // Cross-axis width is the marker size when any entry declares a marker,
    // and the connector's own width when none does. Top and bottom are
    // physical: RTL moves the gutter to the other side and never flips the
    // sequence.
    final gutterWidth = component.markerSize ?? component.connector.width;
    final connectorColor = _color(context, component.connector.color);
    final markerColor = component.markerColor == null
        ? null
        : _color(context, component.markerColor!);

    final rows = <Widget>[];
    for (var index = 0; index < component.entries.length; index += 1) {
      final entry = component.entries[index];
      final isFirst = index == 0;
      final isLast = index == component.entries.length - 1;
      // The gap lives inside the entry rather than between entries, so the
      // connector keeps running through it instead of being cut at every seam.
      final entryElements = announcement.elements
          .where((element) => element.item == entry.id)
          .toList(growable: false);
      String elementText(String segment) => entryElements
          .firstWhere((element) => element.segment == segment)
          .text;
      final content = Padding(
        padding: EdgeInsetsDirectional.only(
          start: 12,
          bottom: isLast ? 0 : component.gap,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _announcedElement(
              elementText('title'),
              Text(
                _localization.text(entry.title),
                style: _textStyle(
                  context,
                  component.titleTypography,
                  component.titleTypography.style,
                ),
                textAlign: _textAlign(component.titleTypography.alignment),
              ),
            ),
            // An absent description produces no element and no second line,
            // and reserves no space for one.
            if (entry.description case final description?)
              _announcedElement(
                elementText('description'),
                Text(
                  _localization.text(description),
                  style: _textStyle(
                    context,
                    component.descriptionTypography,
                    component.descriptionTypography!.style,
                  ),
                  textAlign:
                      _textAlign(component.descriptionTypography!.alignment),
                ),
              ),
          ],
        ),
      );

      rows.add(
        // One list item per entry. It groups its own elements and carries no
        // label of its own, so nothing is announced twice.
        Semantics(
          key: ValueKey<String>('mosaic-${component.id}-${entry.id}'),
          container: true,
          explicitChildNodes: true,
          child: Padding(
            padding: EdgeInsets.zero,
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  SizedBox(
                    width: gutterWidth,
                    child: CustomPaint(
                      painter: _MosaicTimelineConnectorPainter(
                        color: connectorColor,
                        width: component.connector.width,
                        dashed: component.connector.style ==
                            MosaicTimelineConnectorStyle.dashed,
                        markerExtent: markerExtent,
                        // A terminal entry that draws a marker stops the line
                        // at that marker's centre; one that draws no marker
                        // lets the line span its full extent. Mid-sequence the
                        // line is always unbroken, marker or not.
                        startsAtMarkerCentre: isFirst && entry.marker != null,
                        endsAtMarkerCentre: isLast && entry.marker != null,
                        drawsAbove: !isFirst,
                        drawsBelow: !isLast,
                      ),
                      child: Align(
                        alignment: Alignment.topCenter,
                        child: _timelineMarker(
                          context,
                          component,
                          entry,
                          ordinal: index + 1,
                          markerColor: markerColor,
                        ),
                      ),
                    ),
                  ),
                  Expanded(child: content),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      container: true,
      explicitChildNodes: true,
      label: announcement.container.label,
      hint: announcement.container.hint,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: rows,
      ),
    );
  }

  /// The decorative glyph for one entry.
  ///
  /// An absent marker occupies no glyph box at all, so the connector runs
  /// unbroken through the entry's position.
  Widget _timelineMarker(
    BuildContext context,
    MosaicTimelineComponent component,
    MosaicTimelineEntry entry, {
    required int ordinal,
    required Color? markerColor,
  }) {
    final marker = entry.marker;
    if (marker == null || markerColor == null || component.markerSize == null) {
      return const SizedBox.shrink();
    }
    return ExcludeSemantics(
      child: _markerGlyph(
        marker,
        ordinal: ordinal,
        color: markerColor,
        size: component.markerSize!,
      ),
    );
  }

  /// Draws one glyph of the shared marker union.
  ///
  /// Shared by Feature List and Timeline since `0.4` consolidated the two
  /// vocabularies: one union, one renderer, so a negated Feature List item and
  /// a Timeline icon entry cannot drift apart.
  Widget _markerGlyph(
    MosaicMarker marker, {
    required int ordinal,
    required Color color,
    required double size,
  }) {
    final markerColor = color;
    final glyph = switch (marker) {
      MosaicDotMarker() => DecoratedBox(
          decoration: BoxDecoration(
            color: markerColor,
            shape: BoxShape.circle,
          ),
          child: SizedBox.square(dimension: size),
        ),
      // ASCII numerals by contract, matching the rating announcement: three
      // renderers must produce the same glyphs, and platform number formatters
      // disagree across locales and OS versions. `package:intl` is
      // deliberately not a dependency. Locale-aware numerals are a deferred
      // protocol change.
      MosaicOrdinalMarker() => SizedBox.square(
          dimension: size,
          child: FittedBox(
            child: Text(
              '$ordinal',
              style: TextStyle(
                color: markerColor,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      MosaicIconMarker(:final name) => Icon(
          _materialIcon(name),
          size: size,
          color: markerColor,
        ),
    };
    return glyph;
  }

  Widget _buildAward(BuildContext context, MosaicAwardComponent component) {
    final announcement = _announcementFor(component);
    String elementText(String segment) => announcement.elements
        .firstWhere((element) => element.segment == segment)
        .text;
    final text = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: _crossAxisAlignment(component.crossAxisAlignment),
      children: <Widget>[
        _announcedElement(
          elementText('title'),
          Text(
            _localization.text(component.title),
            style: _textStyle(
              context,
              component.titleTypography,
              component.titleTypography.style,
            ),
            textAlign: _textAlign(component.titleTypography.alignment),
          ),
        ),
        // An absent subtitle produces no element, never an empty one.
        if (component.subtitle case final subtitle?)
          _announcedElement(
            elementText('subtitle'),
            Text(
              _localization.text(subtitle),
              style: _textStyle(
                context,
                component.subtitleTypography,
                component.subtitleTypography!.style,
              ),
              textAlign: _textAlign(component.subtitleTypography!.alignment),
            ),
          ),
      ],
    );

    // The emblem is always decorative: the title already carries the award's
    // meaning, so an emblem alt text would duplicate or contradict it.
    final emblem = component.emblem == null
        ? null
        : ExcludeSemantics(child: _awardEmblem(context, component.emblem!));
    final children = <Widget>[
      if (emblem != null) ...<Widget>[
        emblem,
        if (component.gap > 0)
          component.direction == MosaicStackDirection.horizontal
              ? SizedBox(width: component.gap)
              : SizedBox(height: component.gap),
      ],
      component.direction == MosaicStackDirection.horizontal
          ? Flexible(child: text)
          : text,
    ];

    final layout = component.direction == MosaicStackDirection.horizontal
        ? Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: _crossAxisAlignment(
              component.crossAxisAlignment,
            ),
            children: children,
          )
        : Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: _crossAxisAlignment(
              component.crossAxisAlignment,
            ),
            children: children,
          );

    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      container: true,
      explicitChildNodes: true,
      label: announcement.container.label,
      hint: announcement.container.hint,
      child: layout,
    );
  }

  Widget _awardEmblem(BuildContext context, MosaicAwardEmblem emblem) {
    switch (emblem) {
      case MosaicAwardIconEmblem(:final name, :final size, :final color):
        return Icon(
          _materialIcon(name),
          size: size,
          color: _color(context, color),
        );
      case MosaicAwardImageEmblem(:final assetId, :final size):
        return SizedBox.square(
          dimension: size,
          child: _decorativeImage(
            context,
            assetId,
            diagnosticKey: 'award-emblem-$assetId',
          ),
        );
    }
  }

  Widget _buildSocialProof(
    BuildContext context,
    MosaicSocialProofComponent component,
  ) {
    final rating = component.rating;
    final avatar = component.avatar;
    final announcement = _announcementFor(component);
    String elementText(String segment) => announcement.elements
        .firstWhere((element) => element.segment == segment)
        .text;
    final quote = _announcedElement(
      elementText('quote'),
      Text(
        _localization.text(component.quote),
        style: _textStyle(
          context,
          component.quoteTypography,
          component.quoteTypography.style,
        ),
        textAlign: _textAlign(component.quoteTypography.alignment),
      ),
    );
    final attribution = _announcedElement(
      elementText('attribution'),
      Text(
        _localization.text(component.attribution),
        style: _textStyle(
          context,
          component.attributionTypography,
          component.attributionTypography.style,
        ),
        textAlign: _textAlign(component.attributionTypography.alignment),
      ),
    );

    final body = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        // An absent rating produces no element and draws no symbols: it is
        // neither a zero rating nor an unknown one.
        if (rating != null) ...<Widget>[
          _announcedElement(
            elementText('rating'),
            _ratingSymbols(context, rating),
          ),
          if (component.gap > 0) SizedBox(height: component.gap),
        ],
        quote,
        if (component.gap > 0) SizedBox(height: component.gap),
        attribution,
      ],
    );

    final layout = avatar == null
        ? body
        : Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              ExcludeSemantics(
                child: ClipOval(
                  child: SizedBox.square(
                    dimension: avatar.size,
                    child: _decorativeImage(
                      context,
                      avatar.assetId,
                      diagnosticKey: 'social-proof-avatar-${avatar.assetId}',
                    ),
                  ),
                ),
              ),
              if (component.gap > 0) SizedBox(width: component.gap),
              Expanded(child: body),
            ],
          );

    // Elements are announced in protocol order — rating, quote, attribution —
    // as separate nodes. Nothing is joined: the platform supplies whatever
    // pause or punctuation its locale and screen reader use.
    return Semantics(
      key: ValueKey<String>('mosaic-${component.id}'),
      container: true,
      explicitChildNodes: true,
      label: announcement.container.label,
      hint: announcement.container.hint,
      child: layout,
    );
  }

  Widget _ratingSymbols(
    BuildContext context,
    MosaicSocialProofRating rating,
  ) {
    final filled = _color(context, rating.filledColor);
    final empty = _color(context, rating.emptyColor);
    final symbols = <Widget>[];
    for (var point = 0; point < rating.maximum; point += 1) {
      // Integer arithmetic throughout: the protocol counts steps precisely so
      // that no runtime has to round a fraction of a symbol.
      final earned = rating.value - point * rating.stepsPerPoint;
      final icon = earned >= rating.stepsPerPoint
          ? Icons.star
          : earned > 0
              ? Icons.star_half
              : Icons.star_border;
      symbols.add(
        Icon(
          icon,
          size: rating.size,
          color: earned > 0 ? filled : empty,
        ),
      );
    }
    return ExcludeSemantics(
      child: Row(mainAxisSize: MainAxisSize.min, children: symbols),
    );
  }

  /// A decorative image asset drawn at a fixed box, diagnosing unavailability
  /// instead of silently leaving a hole.
  Widget _decorativeImage(
    BuildContext context,
    String assetId, {
    required String diagnosticKey,
  }) {
    final asset = widget.document.imageAsset(assetId)!;
    final provider = _imageProvider(asset);
    if (provider == null) {
      _notifyMediaFailure(
        diagnosticKey,
        'background.imageUnavailable',
        'Image asset $assetId is unavailable; nothing is drawn in its place.',
      );
      return const SizedBox.expand();
    }
    return Image(
      image: provider,
      fit: BoxFit.cover,
      excludeFromSemantics: true,
      errorBuilder: (context, error, stackTrace) {
        _notifyMediaFailure(
          diagnosticKey,
          'background.imageUnavailable',
          'Image asset $assetId is unavailable; nothing is drawn in its place.',
        );
        return const SizedBox.expand();
      },
    );
  }

  /// One announced element: the authored text, with the widget that draws it
  /// excluded so the same words are never announced twice.
  Widget _announcedElement(String text, Widget child) => Semantics(
        label: text,
        child: ExcludeSemantics(child: child),
      );

  IconData _materialIcon(MosaicIconName name) => switch (name) {
        MosaicIconName.checkmark => Icons.check,
        MosaicIconName.close => Icons.close,
        MosaicIconName.lock => Icons.lock,
        MosaicIconName.restore => Icons.restore,
        MosaicIconName.externalLink => Icons.open_in_new,
        MosaicIconName.arrowBackward => Icons.arrow_back,
        MosaicIconName.arrowForward => Icons.arrow_forward,
        MosaicIconName.chevronBackward => Icons.chevron_left,
        MosaicIconName.chevronForward => Icons.chevron_right,
      };
}

/// Draws a Timeline entry's share of the connector.
///
/// The line is continuous through entries that declare no marker, because an
/// absent marker means "no glyph here", not "break the sequence".
final class _MosaicTimelineConnectorPainter extends CustomPainter {
  const _MosaicTimelineConnectorPainter({
    required this.color,
    required this.width,
    required this.dashed,
    required this.markerExtent,
    required this.startsAtMarkerCentre,
    required this.endsAtMarkerCentre,
    required this.drawsAbove,
    required this.drawsBelow,
  });

  final Color color;
  final double width;
  final bool dashed;
  final double markerExtent;
  final bool startsAtMarkerCentre;
  final bool endsAtMarkerCentre;
  final bool drawsAbove;
  final bool drawsBelow;

  @override
  void paint(Canvas canvas, Size size) {
    final centerX = size.width / 2;
    final markerCenterY = math.min(markerExtent / 2, size.height);
    final top = drawsAbove || !startsAtMarkerCentre ? 0.0 : markerCenterY;
    final bottom =
        drawsBelow || !endsAtMarkerCentre ? size.height : markerCenterY;
    if (bottom <= top) return;
    final paint = Paint()
      ..color = color
      ..strokeWidth = width
      ..strokeCap = StrokeCap.butt;
    if (!dashed) {
      canvas.drawLine(Offset(centerX, top), Offset(centerX, bottom), paint);
      return;
    }
    const dash = 4.0;
    const space = 3.0;
    var y = top;
    while (y < bottom) {
      final end = math.min(y + dash, bottom);
      canvas.drawLine(Offset(centerX, y), Offset(centerX, end), paint);
      y = end + space;
    }
  }

  @override
  bool shouldRepaint(_MosaicTimelineConnectorPainter oldDelegate) =>
      color != oldDelegate.color ||
      width != oldDelegate.width ||
      dashed != oldDelegate.dashed ||
      markerExtent != oldDelegate.markerExtent ||
      startsAtMarkerCentre != oldDelegate.startsAtMarkerCentre ||
      endsAtMarkerCentre != oldDelegate.endsAtMarkerCentre ||
      drawsAbove != oldDelegate.drawsAbove ||
      drawsBelow != oldDelegate.drawsBelow;
}
