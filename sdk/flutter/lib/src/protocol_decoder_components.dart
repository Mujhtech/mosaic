part of 'protocol.dart';

extension on MosaicProtocolDecoder {
  MosaicButtonComponent _v03Button(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'direction',
        'gap',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
        'action',
        'accessibility',
      },
      optional: const <String>{
        'inProgressChildren',
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final children = _nonEmptyList(object['children'], '$path.children');
    final inProgress = object.containsKey('inProgressChildren')
        ? _nonEmptyList(
            object['inProgressChildren'],
            '$path.inProgressChildren',
          )
        : null;
    final action = _v03ButtonAction(object['action'], '$path.action');
    if (inProgress != null &&
        action is! MosaicPurchaseAction &&
        action is! MosaicRestoreAction) {
      throw MosaicProtocolException(
        'inProgressChildren is valid only for purchase and restore Buttons '
        'at $path.',
      );
    }
    return MosaicButtonComponent(
      id: _identifier(object['id'], '$path.id'),
      direction: _enumValue(
                object['direction'],
                const <String>{'vertical', 'horizontal'},
                '$path.direction',
              ) ==
              'vertical'
          ? MosaicStackDirection.vertical
          : MosaicStackDirection.horizontal,
      gap: _logicalSize(object['gap'], '$path.gap'),
      mainAxisDistribution: _v03Distribution(
        object['mainAxisDistribution'],
        '$path.mainAxisDistribution',
      ),
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      children: <MosaicNode>[
        for (var index = 0; index < children.length; index += 1)
          _v03Node(children[index], '$path.children[$index]'),
      ],
      inProgressChildren: inProgress == null
          ? null
          : <MosaicNode>[
              for (var index = 0; index < inProgress.length; index += 1)
                _v03Node(
                  inProgress[index],
                  '$path.inProgressChildren[$index]',
                ),
            ],
      action: action,
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicIconComponent _v03Icon(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'name',
        'size',
        'color',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    return MosaicIconComponent(
      id: _identifier(object['id'], '$path.id'),
      name: _v03IconName(object['name'], '$path.name'),
      size: _boundedNumber(
        object['size'],
        '$path.size',
        minimumExclusive: 0,
        maximum: 4096,
      ),
      color: _v03Color(object['color'], '$path.color'),
      accessibility: _imageAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicAction _v03ButtonAction(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'purchase' => _purchaseAction(object, path),
      'restore' => _restoreAction(object, path),
      'close' => _closeAction(object, path),
      'navigateTo' => () {
          _expectKeys(object, const <String>{'type', 'screenId'}, path);
          return MosaicNavigateToAction(
            screenId: _identifier(object['screenId'], '$path.screenId'),
          );
        }(),
      'navigateBack' => () {
          _expectKeys(object, const <String>{'type'}, path);
          return const MosaicNavigateBackAction();
        }(),
      'openExternalUrl' => () {
          _expectKeys(object, const <String>{'type', 'url'}, path);
          return MosaicOpenExternalUrlAction(
            url: _v03ExternalUrl(object['url'], '$path.url'),
          );
        }(),
      _ => throw MosaicProtocolException(
          'Unsupported Button action "$type" at $path.type.',
        ),
    };
  }

  Uri _v03ExternalUrl(Object? value, String path) {
    final source = _string(value, path);
    final uri = Uri.tryParse(source);
    final match = RegExp(
      r'^https://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$',
      unicode: true,
    ).firstMatch(source);
    final rawHost = match?.group(1);
    final rawPort = int.tryParse(match?.group(2) ?? '');
    if (source.runes.length > 2048 ||
        match == null ||
        uri == null ||
        uri.scheme != 'https' ||
        !uri.hasAuthority ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        rawHost == null ||
        rawHost.contains('..') ||
        rawHost.toLowerCase() != uri.host.toLowerCase() ||
        (rawPort != null && rawPort > 65535)) {
      throw MosaicProtocolException(
        'External URL must be an absolute HTTPS URL without credentials at '
        '$path.',
      );
    }
    return uri;
  }

  MosaicCarouselComponent _v03Carousel(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'initialPageIndex',
        'showsIndicators',
        'pages',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final values = _list(object['pages'], '$path.pages');
    if (values.length < 2 || values.length > 20) {
      throw MosaicProtocolException(
        'Carousel pages must contain 2 through 20 entries at $path.pages.',
      );
    }
    final pages = <MosaicCarouselPage>[];
    for (var index = 0; index < values.length; index += 1) {
      final pagePath = '$path.pages[$index]';
      final page = _object(values[index], pagePath);
      _expectKeys(
        page,
        const <String>{'id', 'accessibilityLabel', 'content'},
        pagePath,
      );
      pages.add(
        MosaicCarouselPage(
          id: _identifier(page['id'], '$pagePath.id'),
          accessibilityLabel: _localizedText(
            page['accessibilityLabel'],
            '$pagePath.accessibilityLabel',
          ),
          content: _v03Stack(page['content'], '$pagePath.content'),
        ),
      );
    }
    return MosaicCarouselComponent(
      id: _identifier(object['id'], '$path.id'),
      initialPageIndex: _integerInRange(
        object['initialPageIndex'],
        '$path.initialPageIndex',
        minimum: 0,
        maximum: 19,
      ),
      showsIndicators: _boolean(
        object['showsIndicators'],
        '$path.showsIndicators',
      ),
      pages: pages,
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v03OptionalAppearance(
        object,
        path,
        container: true,
      ),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicSwitchComponent _v03Switch(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'label',
        'initialValue',
        'typography',
        'offTrackColor',
        'onTrackColor',
        'thumbColor',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    return MosaicSwitchComponent(
      id: _identifier(object['id'], '$path.id'),
      label: _localizedText(object['label'], '$path.label'),
      initialValue: _boolean(object['initialValue'], '$path.initialValue'),
      typography: _v03Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      offTrackColor: _v03Color(
        object['offTrackColor'],
        '$path.offTrackColor',
      ),
      onTrackColor: _v03Color(
        object['onTrackColor'],
        '$path.onTrackColor',
      ),
      thumbColor: _v03Color(object['thumbColor'], '$path.thumbColor'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicCountdownComponent _v03Countdown(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'endsAt',
        'largestUnit',
        'smallestUnit',
        'completedText',
        'typography',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final endsAtSource = _string(object['endsAt'], '$path.endsAt');
    if (!RegExp(
      r'^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$',
    ).hasMatch(endsAtSource)) {
      throw MosaicProtocolException(
        'Countdown endsAt must be a canonical UTC instant at $path.endsAt.',
      );
    }
    final endsAt = DateTime.tryParse(endsAtSource);
    if (endsAt == null ||
        '${endsAt.toUtc().toIso8601String().split('.').first}Z' !=
            endsAtSource) {
      throw MosaicProtocolException(
        'Countdown endsAt must be a real canonical UTC instant at '
        '$path.endsAt.',
      );
    }
    final largest = _v03CountdownUnit(
      object['largestUnit'],
      '$path.largestUnit',
    );
    final smallest = _v03CountdownUnit(
      object['smallestUnit'],
      '$path.smallestUnit',
    );
    if (largest.index > smallest.index) {
      throw MosaicProtocolException(
        'Countdown largestUnit must not be smaller than smallestUnit at '
        '$path.',
      );
    }
    return MosaicCountdownComponent(
      id: _identifier(object['id'], '$path.id'),
      endsAt: endsAt.toUtc(),
      largestUnit: largest,
      smallestUnit: smallest,
      completedText: _localizedText(
        object['completedText'],
        '$path.completedText',
      ),
      typography: _v03Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      accessibility: _v03TextAccessibility(
        object['accessibility'],
        '$path.accessibility',
        allowHeading: true,
      ),
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicTabsComponent _v03Tabs(Map<String, Object?> object, String path) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'tabBarDirection',
        'tabBarGap',
        'tabBarDistribution',
        'gap',
        'initialTabId',
        'tabs',
        'styles',
        'labelTypography',
        'selectedLabelColor',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final values = _list(object['tabs'], '$path.tabs');
    if (values.length < 2 || values.length > 8) {
      throw MosaicProtocolException(
        'Tabs must contain 2 through 8 entries at $path.tabs.',
      );
    }
    final tabs = <MosaicTabsEntry>[];
    for (var index = 0; index < values.length; index += 1) {
      final tabPath = '$path.tabs[$index]';
      final tab = _object(values[index], tabPath);
      _expectKeys(tab, const <String>{'id', 'label', 'content'}, tabPath);
      tabs.add(
        MosaicTabsEntry(
          id: _identifier(tab['id'], '$tabPath.id'),
          label: _localizedText(tab['label'], '$tabPath.label'),
          content: _v03Stack(tab['content'], '$tabPath.content'),
        ),
      );
    }
    return MosaicTabsComponent(
      id: _identifier(object['id'], '$path.id'),
      tabBarDirection: _v03StackDirection(
        object['tabBarDirection'],
        '$path.tabBarDirection',
      ),
      tabBarGap: _logicalSize(object['tabBarGap'], '$path.tabBarGap'),
      tabBarDistribution: _v03Distribution(
        object['tabBarDistribution'],
        '$path.tabBarDistribution',
      ),
      gap: _logicalSize(object['gap'], '$path.gap'),
      initialTabId: _identifier(object['initialTabId'], '$path.initialTabId'),
      tabs: tabs,
      styles: _v03SelectionStyles(object['styles'], '$path.styles'),
      labelTypography: _v03Typography(
        object['labelTypography'],
        '$path.labelTypography',
        allowMaximumLines: false,
      ),
      selectedLabelColor: _v03Color(
        object['selectedLabelColor'],
        '$path.selectedLabelColor',
      ),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v03OptionalAppearance(object, path, container: true),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicTimelineComponent _v03Timeline(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'orientation',
        'gap',
        'connector',
        'entries',
        'titleTypography',
        'accessibility',
      },
      optional: const <String>{
        'markerColor',
        'markerSize',
        'descriptionTypography',
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    _expectConst(object['orientation'], 'vertical', '$path.orientation');
    final values = _list(object['entries'], '$path.entries');
    if (values.length < 2 || values.length > 12) {
      throw MosaicProtocolException(
        'Timeline must contain 2 through 12 entries at $path.entries.',
      );
    }
    final entries = <MosaicTimelineEntry>[];
    for (var index = 0; index < values.length; index += 1) {
      final entryPath = '$path.entries[$index]';
      final entry = _object(values[index], entryPath);
      _expectKeys(
        entry,
        const <String>{'id', 'title'},
        entryPath,
        optional: const <String>{'description', 'marker'},
      );
      entries.add(
        MosaicTimelineEntry(
          id: _identifier(entry['id'], '$entryPath.id'),
          title: _localizedText(entry['title'], '$entryPath.title'),
          description: entry.containsKey('description')
              ? _localizedText(entry['description'], '$entryPath.description')
              : null,
          marker: entry.containsKey('marker')
              ? _v03TimelineMarker(entry['marker'], '$entryPath.marker')
              : null,
        ),
      );
    }
    final usesMarkers = entries.any((entry) => entry.marker != null);
    final usesDescriptions = entries.any((entry) => entry.description != null);
    // Both directions are enforced. A missing style where a marker exists
    // leaves the renderer choosing a colour; a declared style where no marker
    // exists is a value nothing reads, which is how a stale field survives a
    // redesign unnoticed.
    for (final (field, used) in <(String, bool)>[
      ('markerColor', usesMarkers),
      ('markerSize', usesMarkers),
      ('descriptionTypography', usesDescriptions),
    ]) {
      final declared = object.containsKey(field);
      if (used && !declared) {
        throw MosaicProtocolException(
          'Timeline must declare $field at $path.$field because an entry '
          'consumes it.',
        );
      }
      if (!used && declared) {
        throw MosaicProtocolException(
          'Timeline declares $field at $path.$field but no entry uses it.',
        );
      }
    }
    return MosaicTimelineComponent(
      id: _identifier(object['id'], '$path.id'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      connector: _v03TimelineConnector(
        object['connector'],
        '$path.connector',
      ),
      entries: entries,
      titleTypography: _v03Typography(
        object['titleTypography'],
        '$path.titleTypography',
        allowMaximumLines: false,
      ),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      markerColor: usesMarkers
          ? _v03Color(object['markerColor'], '$path.markerColor')
          : null,
      markerSize: usesMarkers
          ? _boundedNumber(
              object['markerSize'],
              '$path.markerSize',
              minimumExclusive: 0,
              maximum: 4096,
            )
          : null,
      descriptionTypography: usesDescriptions
          ? _v03Typography(
              object['descriptionTypography'],
              '$path.descriptionTypography',
              allowMaximumLines: false,
            )
          : null,
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicTimelineConnector _v03TimelineConnector(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'color', 'width', 'style'}, path);
    return MosaicTimelineConnector(
      color: _v03Color(object['color'], '$path.color'),
      width: _boundedNumber(
        object['width'],
        '$path.width',
        minimumExclusive: 0,
        maximum: 4096,
      ),
      style: switch (_enumValue(
        object['style'],
        const <String>{'solid', 'dashed'},
        '$path.style',
      )) {
        'solid' => MosaicTimelineConnectorStyle.solid,
        'dashed' => MosaicTimelineConnectorStyle.dashed,
        final unreachable =>
          throw StateError('Unhandled connector style "$unreachable".'),
      },
    );
  }

  MosaicTimelineMarker _v03TimelineMarker(Object? value, String path) {
    final object = _object(value, path);
    final kind = _enumValue(
      object['kind'],
      const <String>{'dot', 'ordinal', 'icon'},
      '$path.kind',
    );
    switch (kind) {
      case 'dot':
        _expectKeys(object, const <String>{'kind'}, path);
        return const MosaicTimelineDotMarker();
      case 'ordinal':
        _expectKeys(object, const <String>{'kind'}, path);
        return const MosaicTimelineOrdinalMarker();
      case 'icon':
        _expectKeys(object, const <String>{'kind', 'name'}, path);
        return MosaicTimelineIconMarker(
          _v03IconName(object['name'], '$path.name'),
        );
      // `_enumValue` already rejected every other string, so a value here means
      // the accepted set and this mapping disagree. That is an SDK bug, and it
      // must never be absorbed as a plausible-looking glyph.
      default:
        throw StateError('Unhandled timeline marker kind "$kind".');
    }
  }

  MosaicAwardComponent _v03Award(Map<String, Object?> object, String path) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'direction',
        'gap',
        'crossAxisAlignment',
        'title',
        'titleTypography',
        'accessibility',
      },
      optional: const <String>{
        'emblem',
        'subtitle',
        'subtitleTypography',
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final hasSubtitle = object.containsKey('subtitle');
    if (hasSubtitle != object.containsKey('subtitleTypography')) {
      throw MosaicProtocolException(
        'Award subtitle and subtitleTypography must appear together at $path.',
      );
    }
    return MosaicAwardComponent(
      id: _identifier(object['id'], '$path.id'),
      direction: _v03StackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      emblem: object.containsKey('emblem')
          ? _v03AwardEmblem(object['emblem'], '$path.emblem')
          : null,
      title: _localizedText(object['title'], '$path.title'),
      titleTypography: _v03Typography(
        object['titleTypography'],
        '$path.titleTypography',
        allowMaximumLines: false,
      ),
      subtitle: hasSubtitle
          ? _localizedText(object['subtitle'], '$path.subtitle')
          : null,
      subtitleTypography: hasSubtitle
          ? _v03Typography(
              object['subtitleTypography'],
              '$path.subtitleTypography',
              allowMaximumLines: false,
            )
          : null,
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicAwardEmblem _v03AwardEmblem(Object? value, String path) {
    final object = _object(value, path);
    final type = _enumValue(
      object['type'],
      const <String>{'image', 'icon'},
      '$path.type',
    );
    if (type == 'image') {
      _expectKeys(object, const <String>{'type', 'assetId', 'size'}, path);
      return MosaicAwardImageEmblem(
        assetId: _identifier(object['assetId'], '$path.assetId'),
        size: _boundedNumber(
          object['size'],
          '$path.size',
          minimumExclusive: 0,
          maximum: 4096,
        ),
      );
    }
    _expectKeys(
      object,
      const <String>{'type', 'name', 'size', 'color'},
      path,
    );
    return MosaicAwardIconEmblem(
      name: _v03IconName(object['name'], '$path.name'),
      size: _boundedNumber(
        object['size'],
        '$path.size',
        minimumExclusive: 0,
        maximum: 4096,
      ),
      color: _v03Color(object['color'], '$path.color'),
    );
  }

  MosaicSocialProofComponent _v03SocialProof(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'gap',
        'quote',
        'quoteTypography',
        'attribution',
        'attributionTypography',
        'accessibility',
      },
      optional: const <String>{
        'rating',
        'avatar',
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    return MosaicSocialProofComponent(
      id: _identifier(object['id'], '$path.id'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      quote: _localizedText(object['quote'], '$path.quote'),
      quoteTypography: _v03Typography(
        object['quoteTypography'],
        '$path.quoteTypography',
        allowMaximumLines: false,
      ),
      attribution: _localizedText(object['attribution'], '$path.attribution'),
      attributionTypography: _v03Typography(
        object['attributionTypography'],
        '$path.attributionTypography',
        allowMaximumLines: false,
      ),
      rating: object.containsKey('rating')
          ? _v03SocialProofRating(object['rating'], '$path.rating')
          : null,
      avatar: object.containsKey('avatar')
          ? _v03SocialProofAvatar(object['avatar'], '$path.avatar')
          : null,
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicSocialProofRating _v03SocialProofRating(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'symbol',
        'value',
        'maximum',
        'step',
        'size',
        'filledColor',
        'emptyColor',
      },
      path,
    );
    _expectConst(object['symbol'], 'star', '$path.symbol');
    final step = switch (_enumValue(
      object['step'],
      const <String>{'whole', 'half'},
      '$path.step',
    )) {
      'whole' => MosaicRatingStep.whole,
      'half' => MosaicRatingStep.half,
      final unreachable =>
        throw StateError('Unhandled rating step "$unreachable".'),
    };
    final rating = MosaicSocialProofRating(
      value: _integerInRange(
        object['value'],
        '$path.value',
        minimum: 0,
        maximum: 20,
      ),
      maximum: _integerInRange(
        object['maximum'],
        '$path.maximum',
        minimum: 1,
        maximum: 10,
      ),
      step: step,
      size: _boundedNumber(
        object['size'],
        '$path.size',
        minimumExclusive: 0,
        maximum: 4096,
      ),
      filledColor: _v03Color(object['filledColor'], '$path.filledColor'),
      emptyColor: _v03Color(object['emptyColor'], '$path.emptyColor'),
    );
    if (rating.value > rating.maximumSteps) {
      throw MosaicProtocolException(
        'Social Proof rating value ${rating.value} exceeds '
        '${rating.maximumSteps} ${object['step']} steps out of '
        '${rating.maximum} at $path.value.',
      );
    }
    return rating;
  }

  MosaicSocialProofAvatar _v03SocialProofAvatar(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'assetId', 'size'}, path);
    return MosaicSocialProofAvatar(
      assetId: _identifier(object['assetId'], '$path.assetId'),
      size: _boundedNumber(
        object['size'],
        '$path.size',
        minimumExclusive: 0,
        maximum: 4096,
      ),
    );
  }

  MosaicIconName _v03IconName(Object? value, String path) =>
      MosaicIconName.values.byName(
        _enumValue(
          value,
          const <String>{
            'checkmark',
            'close',
            'lock',
            'restore',
            'externalLink',
            'arrowBackward',
            'arrowForward',
            'chevronBackward',
            'chevronForward',
          },
          path,
        ),
      );

  void _expectV03ComponentKeys(
    Map<String, Object?> object,
    String path, {
    required Set<String> required,
    required Set<String> optional,
  }) {
    _expectKeys(object, required, path, optional: optional);
  }

  MosaicColorValue _v03Color(Object? value, String path) {
    if (value is Map<String, Object?>) {
      _expectKeys(value, const <String>{'type', 'id'}, path);
      _expectConst(value['type'], 'colorToken', '$path.type');
      return MosaicColorValue.token(_identifier(value['id'], '$path.id'));
    }
    final source = _string(value, path);
    try {
      return MosaicColorValue.parse(source);
    } on MosaicProtocolException {
      throw MosaicProtocolException('Invalid color "$source" at $path.');
    }
  }

  MosaicBackground _v03Background(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    switch (type) {
      case 'color':
        _expectKeys(object, const <String>{'type', 'value'}, path);
        return MosaicColorBackground(_v03Color(object['value'], '$path.value'));
      case 'linearGradient':
        _expectKeys(object, const <String>{'type', 'angle', 'stops'}, path);
        return MosaicLinearGradientBackground(
          angle: _boundedNumber(
            object['angle'],
            '$path.angle',
            minimum: 0,
            maximum: 360,
          ),
          stops: _v03GradientStops(object['stops'], '$path.stops'),
        );
      case 'radialGradient':
        _expectKeys(
          object,
          const <String>{'type', 'center', 'radius', 'stops'},
          path,
        );
        final center = _object(object['center'], '$path.center');
        _expectKeys(center, const <String>{'x', 'y'}, '$path.center');
        return MosaicRadialGradientBackground(
          centerX: _boundedNumber(
            center['x'],
            '$path.center.x',
            minimum: 0,
            maximum: 1,
          ),
          centerY: _boundedNumber(
            center['y'],
            '$path.center.y',
            minimum: 0,
            maximum: 1,
          ),
          radius: _boundedNumber(
            object['radius'],
            '$path.radius',
            minimumExclusive: 0,
            maximum: 2,
          ),
          stops: _v03GradientStops(object['stops'], '$path.stops'),
        );
      case 'image':
      case 'video':
        _expectKeys(
          object,
          const <String>{'type', 'assetId', 'contentMode', 'fallbackColor'},
          path,
          optional: type == 'video'
              ? const <String>{'posterAssetId'}
              : const <String>{},
        );
        final mode = _enumValue(
          object['contentMode'],
          const <String>{'fit', 'fill'},
          '$path.contentMode',
        );
        final contentMode = mode == 'fit'
            ? MosaicImageContentMode.fit
            : MosaicImageContentMode.fill;
        final fallback = _v03Color(
          object['fallbackColor'],
          '$path.fallbackColor',
        );
        if (type == 'image') {
          return MosaicImageBackground(
            assetId: _identifier(object['assetId'], '$path.assetId'),
            contentMode: contentMode,
            fallbackColor: fallback,
          );
        }
        return MosaicVideoBackground(
          assetId: _identifier(object['assetId'], '$path.assetId'),
          posterAssetId: object.containsKey('posterAssetId')
              ? _identifier(object['posterAssetId'], '$path.posterAssetId')
              : null,
          contentMode: contentMode,
          fallbackColor: fallback,
        );
      case 'backgroundToken':
        _expectKeys(object, const <String>{'type', 'id'}, path);
        return MosaicBackgroundTokenReference(
          _identifier(object['id'], '$path.id'),
        );
      default:
        throw MosaicProtocolException('Unsupported background at $path.type.');
    }
  }

  List<MosaicGradientStop> _v03GradientStops(Object? value, String path) {
    final values = _list(value, path);
    if (values.length < 2 || values.length > 8) {
      throw MosaicProtocolException(
        'Gradient stops must contain 2 through 8 entries at $path.',
      );
    }
    final stops = <MosaicGradientStop>[];
    var previous = -1.0;
    for (var index = 0; index < values.length; index += 1) {
      final stopPath = '$path[$index]';
      final object = _object(values[index], stopPath);
      _expectKeys(object, const <String>{'position', 'color'}, stopPath);
      final position = _boundedNumber(
        object['position'],
        '$stopPath.position',
        minimum: 0,
        maximum: 1,
      );
      if (position <= previous) {
        throw MosaicProtocolException(
          'Gradient stop positions must be strictly increasing at $path.',
        );
      }
      previous = position;
      stops.add(
        MosaicGradientStop(
          position: position,
          color: _v03Color(object['color'], '$stopPath.color'),
        ),
      );
    }
    return stops;
  }

  MosaicShadow _v03Shadow(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    if (type == 'shadowToken') {
      _expectKeys(object, const <String>{'type', 'id'}, path);
      return MosaicShadowTokenReference(_identifier(object['id'], '$path.id'));
    }
    _expectKeys(
      object,
      const <String>{'type', 'color', 'offsetX', 'offsetY', 'blurRadius'},
      path,
    );
    _expectConst(type, 'shadow', '$path.type');
    return MosaicInlineShadow(
      color: _v03Color(object['color'], '$path.color'),
      offsetX: _boundedNumber(
        object['offsetX'],
        '$path.offsetX',
        minimum: -4096,
        maximum: 4096,
      ),
      offsetY: _boundedNumber(
        object['offsetY'],
        '$path.offsetY',
        minimum: -4096,
        maximum: 4096,
      ),
      blurRadius: _logicalSize(object['blurRadius'], '$path.blurRadius'),
    );
  }

  MosaicBoxAppearance? _v03OptionalAppearance(
    Map<String, Object?> parent,
    String parentPath, {
    bool container = false,
  }) {
    if (!parent.containsKey('appearance')) return null;
    final path = '$parentPath.appearance';
    final object = _object(parent['appearance'], path);
    final allowed = <String>{
      'background',
      'border',
      'cornerRadius',
      'opacity',
      if (!container) 'padding',
      if (container) 'clipContent',
      'shadow',
    };
    if (object.isEmpty) {
      throw MosaicProtocolException(
        'Expected at least one appearance property at $path.',
      );
    }
    _expectKeys(object, const <String>{}, path, optional: allowed);
    return MosaicBoxAppearance(
      background: object.containsKey('background')
          ? _v03Background(object['background'], '$path.background')
          : null,
      border: object.containsKey('border')
          ? _v03Border(object['border'], '$path.border')
          : null,
      cornerRadius: object.containsKey('cornerRadius')
          ? _logicalSize(object['cornerRadius'], '$path.cornerRadius')
          : null,
      opacity: object.containsKey('opacity')
          ? _boundedNumber(
              object['opacity'],
              '$path.opacity',
              minimum: 0,
              maximum: 1,
            )
          : null,
      padding: object.containsKey('padding')
          ? _edgeInsets(object['padding'], '$path.padding')
          : null,
      clipContent: object.containsKey('clipContent')
          ? _boolean(object['clipContent'], '$path.clipContent')
          : null,
      shadow: object.containsKey('shadow')
          ? _v03Shadow(object['shadow'], '$path.shadow')
          : null,
    );
  }

  MosaicBorderStyle _v03Border(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'color', 'width'}, path);
    return MosaicBorderStyle(
      color: _v03Color(object['color'], '$path.color'),
      width: _logicalSize(object['width'], '$path.width'),
    );
  }

  MosaicSizing? _v03OptionalSizing(
    Map<String, Object?> parent,
    String parentPath,
  ) {
    if (!parent.containsKey('sizing')) return null;
    final path = '$parentPath.sizing';
    final object = _object(parent['sizing'], path);
    _expectKeys(object, const <String>{'width', 'height'}, path);
    return MosaicSizing(
      width: _v03SizingValue(object['width'], '$path.width'),
      height: _v03SizingValue(object['height'], '$path.height'),
    );
  }

  MosaicSizingValue _v03SizingValue(Object? value, String path) {
    if (value is String) {
      final mode = _enumValue(value, const <String>{'fit', 'fill'}, path);
      return mode == 'fill'
          ? const MosaicSizingValue.fill()
          : const MosaicSizingValue.fit();
    }
    final object = _object(value, path);
    _expectKeys(object, const <String>{'mode', 'value'}, path);
    _expectConst(object['mode'], 'fixed', '$path.mode');
    return MosaicSizingValue.fixed(
      _boundedNumber(
        object['value'],
        '$path.value',
        minimumExclusive: 0,
        maximum: 4096,
      ),
    );
  }

  MosaicEdgeInsets? _v03OptionalInsets(
    Map<String, Object?> parent,
    String parentPath,
    String key,
  ) =>
      parent.containsKey(key)
          ? _edgeInsets(parent[key], '$parentPath.$key')
          : null;

  MosaicVisibility _v03OptionalVisibility(
    Map<String, Object?> parent,
    String parentPath,
  ) {
    if (!parent.containsKey('visibility')) {
      return const MosaicAlwaysVisible();
    }
    final path = '$parentPath.visibility';
    final object = _object(parent['visibility'], path);
    final mode = _string(object['mode'], '$path.mode');
    switch (mode) {
      case 'always':
        _expectKeys(object, const <String>{'mode'}, path);
        return const MosaicAlwaysVisible();
      case 'hidden':
        _expectKeys(object, const <String>{'mode'}, path);
        return const MosaicStaticallyHidden();
      case 'switch':
        _expectKeys(
          object,
          const <String>{'mode', 'switchId', 'equals'},
          path,
        );
        return MosaicSwitchVisibility(
          switchId: _identifier(object['switchId'], '$path.switchId'),
          equals: _boolean(object['equals'], '$path.equals'),
        );
      case 'tab':
        _expectKeys(
          object,
          const <String>{'mode', 'tabsId', 'equals'},
          path,
        );
        return MosaicTabVisibility(
          tabsId: _identifier(object['tabsId'], '$path.tabsId'),
          equals: _identifier(object['equals'], '$path.equals'),
        );
      default:
        throw MosaicProtocolException('Invalid visibility mode at $path.mode.');
    }
  }
}
