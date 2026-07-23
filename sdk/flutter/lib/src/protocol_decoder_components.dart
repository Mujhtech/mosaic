part of 'protocol.dart';

extension on MosaicProtocolDecoder {
  MosaicButtonComponent _v02Button(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
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
    final action = _v02ButtonAction(object['action'], '$path.action');
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
      mainAxisDistribution: _v02Distribution(
        object['mainAxisDistribution'],
        '$path.mainAxisDistribution',
      ),
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      children: <MosaicNode>[
        for (var index = 0; index < children.length; index += 1)
          _v02Node(children[index], '$path.children[$index]'),
      ],
      inProgressChildren: inProgress == null
          ? null
          : <MosaicNode>[
              for (var index = 0; index < inProgress.length; index += 1)
                _v02Node(
                  inProgress[index],
                  '$path.inProgressChildren[$index]',
                ),
            ],
      action: action,
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicIconComponent _v02Icon(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
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
    final iconName = _enumValue(
      object['name'],
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
      '$path.name',
    );
    return MosaicIconComponent(
      id: _identifier(object['id'], '$path.id'),
      name: MosaicIconName.values.byName(iconName),
      size: _boundedNumber(
        object['size'],
        '$path.size',
        minimumExclusive: 0,
        maximum: 4096,
      ),
      color: _v02Color(object['color'], '$path.color'),
      accessibility: _imageAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicAction _v02ButtonAction(Object? value, String path) {
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
            url: _v02ExternalUrl(object['url'], '$path.url'),
          );
        }(),
      _ => throw MosaicProtocolException(
          'Unsupported Button action "$type" at $path.type.',
        ),
    };
  }

  Uri _v02ExternalUrl(Object? value, String path) {
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

  MosaicCarouselComponent _v02Carousel(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
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
          content: _v02Stack(page['content'], '$pagePath.content'),
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
      appearance: _v02OptionalAppearance(
        object,
        path,
        container: true,
      ),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicSwitchComponent _v02Switch(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
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
      typography: _v02Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      offTrackColor: _v02Color(
        object['offTrackColor'],
        '$path.offTrackColor',
      ),
      onTrackColor: _v02Color(
        object['onTrackColor'],
        '$path.onTrackColor',
      ),
      thumbColor: _v02Color(object['thumbColor'], '$path.thumbColor'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicCountdownComponent _v02Countdown(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
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
    final largest = _v02CountdownUnit(
      object['largestUnit'],
      '$path.largestUnit',
    );
    final smallest = _v02CountdownUnit(
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
      typography: _v02Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      accessibility: _v02TextAccessibility(
        object['accessibility'],
        '$path.accessibility',
        allowHeading: true,
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  void _expectV02ComponentKeys(
    Map<String, Object?> object,
    String path, {
    required Set<String> required,
    required Set<String> optional,
  }) {
    _expectKeys(object, required, path, optional: optional);
  }

  MosaicColorValue _v02Color(Object? value, String path) {
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

  MosaicBackground _v02Background(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    switch (type) {
      case 'color':
        _expectKeys(object, const <String>{'type', 'value'}, path);
        return MosaicColorBackground(_v02Color(object['value'], '$path.value'));
      case 'linearGradient':
        _expectKeys(object, const <String>{'type', 'angle', 'stops'}, path);
        return MosaicLinearGradientBackground(
          angle: _boundedNumber(
            object['angle'],
            '$path.angle',
            minimum: 0,
            maximum: 360,
          ),
          stops: _v02GradientStops(object['stops'], '$path.stops'),
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
          stops: _v02GradientStops(object['stops'], '$path.stops'),
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
        final fallback = _v02Color(
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

  List<MosaicGradientStop> _v02GradientStops(Object? value, String path) {
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
          color: _v02Color(object['color'], '$stopPath.color'),
        ),
      );
    }
    return stops;
  }

  MosaicShadow _v02Shadow(Object? value, String path) {
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
      color: _v02Color(object['color'], '$path.color'),
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

  MosaicBoxAppearance? _v02OptionalAppearance(
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
          ? _v02Background(object['background'], '$path.background')
          : null,
      border: object.containsKey('border')
          ? _v02Border(object['border'], '$path.border')
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
          ? _v02Shadow(object['shadow'], '$path.shadow')
          : null,
    );
  }

  MosaicBorderStyle _v02Border(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'color', 'width'}, path);
    return MosaicBorderStyle(
      color: _v02Color(object['color'], '$path.color'),
      width: _logicalSize(object['width'], '$path.width'),
    );
  }

  MosaicSizing? _v02OptionalSizing(
    Map<String, Object?> parent,
    String parentPath,
  ) {
    if (!parent.containsKey('sizing')) return null;
    final path = '$parentPath.sizing';
    final object = _object(parent['sizing'], path);
    _expectKeys(object, const <String>{'width', 'height'}, path);
    return MosaicSizing(
      width: _v02SizingValue(object['width'], '$path.width'),
      height: _v02SizingValue(object['height'], '$path.height'),
    );
  }

  MosaicSizingValue _v02SizingValue(Object? value, String path) {
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

  MosaicEdgeInsets? _v02OptionalInsets(
    Map<String, Object?> parent,
    String parentPath,
    String key,
  ) =>
      parent.containsKey(key)
          ? _edgeInsets(parent[key], '$parentPath.$key')
          : null;

  MosaicVisibility _v02OptionalVisibility(
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
      default:
        throw MosaicProtocolException('Invalid visibility mode at $path.mode.');
    }
  }
}
