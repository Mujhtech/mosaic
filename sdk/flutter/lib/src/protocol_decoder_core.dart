part of 'protocol.dart';

extension on MosaicProtocolDecoder {
  MosaicPaywallDocument _decodeV03(Map<String, Object?> root) {
    _expectKeys(
      root,
      const <String>{
        'schemaVersion',
        'id',
        'revision',
        'compatibility',
        'localization',
        'designSystem',
        'assets',
        'products',
        'initialScreenId',
        'screens',
      },
      r'$',
    );
    final screenValues = _list(root['screens'], r'$.screens');
    if (screenValues.isEmpty || screenValues.length > 10) {
      throw const MosaicProtocolException(
        'Protocol 0.3 screens must contain between 1 and 10 entries.',
      );
    }
    final screens = <MosaicPaywallScreen>[
      for (var index = 0; index < screenValues.length; index += 1)
        _v03Screen(screenValues[index], '\$.screens[$index]'),
    ];
    if (screens.length > 1 &&
        screens.any((screen) => screen.accessibilityLabel == null)) {
      throw const MosaicProtocolException(
        'Every Protocol 0.3 Paywall Screen must have an accessibilityLabel '
        'when the document contains multiple screens.',
      );
    }
    final initialScreenId =
        _identifier(root['initialScreenId'], r'$.initialScreenId');
    final initialScreen =
        screens.where((screen) => screen.id == initialScreenId);
    if (initialScreen.length != 1) {
      throw MosaicProtocolException(
        'initialScreenId "$initialScreenId" must resolve exactly once.',
      );
    }
    final document = MosaicPaywallDocument(
      schemaVersion: mosaicProtocolVersion,
      id: _identifier(root['id'], r'$.id'),
      revision: _positiveInteger(root['revision'], r'$.revision'),
      compatibility: _compatibilityFor(
        root['compatibility'],
        version: mosaicProtocolVersion,
        supported: mosaicProtocolV03Capabilities,
      ),
      localization: _localization(root['localization']),
      designSystem: _v03DesignSystem(root['designSystem']),
      assets: _v03Assets(root['assets']),
      products: _v03Products(root['products']),
      layout: initialScreen.single.layout,
      initialScreenId: initialScreenId,
      screens: screens,
    );
    _validateDocumentSemantics(document);
    return document;
  }

  MosaicPaywallScreen _v03Screen(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'id', 'presentation', 'layout'},
      path,
      optional: const <String>{'accessibilityLabel'},
    );
    return MosaicPaywallScreen(
      id: _identifier(object['id'], '$path.id'),
      accessibilityLabel: object.containsKey('accessibilityLabel')
          ? _localizedText(
              object['accessibilityLabel'],
              '$path.accessibilityLabel',
            )
          : null,
      presentation: _v03ScreenPresentation(
        object['presentation'],
        '$path.presentation',
      ),
      layout: _v03ScrollContainer(object['layout'], '$path.layout'),
    );
  }

  MosaicScreenPresentation _v03ScreenPresentation(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'type'}, path);
    return _enumValue(
              object['type'],
              const <String>{'screen', 'sheet'},
              '$path.type',
            ) ==
            'sheet'
        ? MosaicScreenPresentation.sheet
        : MosaicScreenPresentation.screen;
  }

  MosaicDocumentCompatibility _compatibilityFor(
    Object? value, {
    required String version,
    required Set<String> supported,
  }) {
    const path = r'$.compatibility';
    final object = _object(value, path);
    _expectKeys(object, const <String>{'requiredCapabilities'}, path);
    final entries = _nonEmptyList(
      object['requiredCapabilities'],
      '$path.requiredCapabilities',
    );
    final capabilities = <MosaicRequiredCapability>[];
    final seen = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final capabilityPath = '$path.requiredCapabilities[$index]';
      final capability = _object(entries[index], capabilityPath);
      _expectKeys(
        capability,
        const <String>{'name', 'version'},
        capabilityPath,
      );
      final name = _string(capability['name'], '$capabilityPath.name');
      final capabilityVersion =
          _string(capability['version'], '$capabilityPath.version');
      if (!supported.contains(name) || capabilityVersion != version) {
        throw MosaicProtocolException.unsupportedCapability(
          'Unsupported capability "$name@$capabilityVersion" at '
          '$capabilityPath.',
        );
      }
      if (!seen.add(name)) {
        throw MosaicProtocolException(
          'Duplicate capability "$name" at $capabilityPath.',
        );
      }
      capabilities.add(
        MosaicRequiredCapability(name: name, version: capabilityVersion),
      );
    }
    return MosaicDocumentCompatibility(capabilities);
  }

  MosaicScrollContainer _v03ScrollContainer(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'axis',
        'safeArea',
        'showsIndicators',
        'content',
      },
      path,
      optional: const <String>{'background'},
    );
    _expectConst(object['type'], 'scrollContainer', '$path.type');
    _expectConst(object['axis'], 'vertical', '$path.axis');
    _expectConst(object['safeArea'], 'respect', '$path.safeArea');
    return MosaicScrollContainer(
      id: _identifier(object['id'], '$path.id'),
      showsIndicators: _boolean(
        object['showsIndicators'],
        '$path.showsIndicators',
      ),
      content: _v03Stack(object['content'], '$path.content'),
      background: object.containsKey('background')
          ? _v03Background(object['background'], '$path.background')
          : null,
    );
  }

  MosaicStackComponent _v03Stack(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'direction',
        'gap',
        'padding',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
      },
      path,
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    _expectConst(object['type'], 'stack', '$path.type');
    final children = _list(object['children'], '$path.children');
    return MosaicStackComponent(
      id: _identifier(object['id'], '$path.id'),
      direction: _v03StackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      padding: _edgeInsets(object['padding'], '$path.padding'),
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

  MosaicNode _v03Node(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'stack' => _v03Stack(object, path),
      'text' => _v03Text(object, path),
      'image' => _v03Image(object, path),
      'featureList' => _v03FeatureList(object, path),
      'productSelector' => _v03ProductSelector(object, path),
      'button' => _v03Button(object, path),
      'icon' => _v03Icon(object, path),
      'carousel' => _v03Carousel(object, path),
      'switch' => _v03Switch(object, path),
      'countdown' => _v03Countdown(object, path),
      'tabs' => _v03Tabs(object, path),
      'timeline' => _v03Timeline(object, path),
      'award' => _v03Award(object, path),
      'socialProof' => _v03SocialProof(object, path),
      // Named rejections for node types earlier protocol versions defined.
      // They are matched as raw strings rather than modelled: a type that
      // exists only to be rejected is still a type a caller can construct, and
      // the sealed node union would then have to carry arms for shapes the
      // contract forbids.
      'verticalStack' ||
      'purchaseButton' ||
      'restoreButton' ||
      'closeButton' ||
      'legalText' =>
        throw MosaicProtocolException.unsupportedCapability(
          'Protocol 0.3 cannot contain "$type" at $path.type; it was removed '
          'with the protocol version that defined it.',
        ),
      _ => throw MosaicProtocolException.unsupportedCapability(
          'Unsupported component type "$type" at $path.type.',
        ),
    };
  }

  MosaicTextComponent _v03Text(Map<String, Object?> object, String path) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'value',
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
    final typography = _v03Typography(
      object['typography'],
      '$path.typography',
      allowMaximumLines: true,
    );
    return MosaicTextComponent(
      id: _identifier(object['id'], '$path.id'),
      value: _localizedText(object['value'], '$path.value'),
      style: typography.style,
      alignment: typography.alignment,
      accessibility: _v03TextAccessibility(
        object['accessibility'],
        '$path.accessibility',
        allowHeading: true,
      ),
      typography: typography,
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicImageComponent _v03Image(Map<String, Object?> object, String path) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'assetId',
        'contentMode',
        'accessibility',
      },
      optional: const <String>{
        'aspectRatio',
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    return MosaicImageComponent(
      id: _identifier(object['id'], '$path.id'),
      assetId: _identifier(object['assetId'], '$path.assetId'),
      aspectRatio: object.containsKey('aspectRatio')
          ? _boundedNumber(
              object['aspectRatio'],
              '$path.aspectRatio',
              minimumExclusive: 0,
              maximum: 10,
            )
          : null,
      sizing: _v03OptionalSizing(object, path),
      contentMode: _enumValue(
                object['contentMode'],
                const <String>{'fit', 'fill'},
                '$path.contentMode',
              ) ==
              'fit'
          ? MosaicImageContentMode.fit
          : MosaicImageContentMode.fill,
      accessibility: _imageAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v03OptionalAppearance(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicFeatureListComponent _v03FeatureList(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV03ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'marker',
        'gap',
        'markerColor',
        'items',
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
    _expectConst(object['marker'], 'checkmark', '$path.marker');
    final items = _nonEmptyList(object['items'], '$path.items');
    final typography = _v03Typography(
      object['typography'],
      '$path.typography',
      allowMaximumLines: false,
    );
    return MosaicFeatureListComponent(
      id: _identifier(object['id'], '$path.id'),
      itemSpacing: _logicalSize(object['gap'], '$path.gap'),
      items: <MosaicFeatureListItem>[
        for (var index = 0; index < items.length; index += 1)
          _featureListItem(items[index], '$path.items[$index]'),
      ],
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      markerColor: _v03Color(object['markerColor'], '$path.markerColor'),
      typography: typography,
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicProductSelectorComponent _v03ProductSelector(
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
        'crossAxisAlignment',
        'initialProductCardId',
        'cards',
        'unavailableFallback',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final cardValues = _nonEmptyList(object['cards'], '$path.cards');
    if (cardValues.length > 20) {
      throw MosaicProtocolException(
        'Product Selector cards must contain at most 20 entries at '
        '$path.cards.',
      );
    }
    final direction = _enumValue(
      object['direction'],
      const <String>{'vertical', 'horizontal'},
      '$path.direction',
    );
    return MosaicProductSelectorComponent(
      id: _identifier(object['id'], '$path.id'),
      cards: <MosaicProductCardComponent>[
        for (var index = 0; index < cardValues.length; index += 1)
          _v03ProductCard(cardValues[index], '$path.cards[$index]'),
      ],
      initialProductCardId: _identifier(
        object['initialProductCardId'],
        '$path.initialProductCardId',
      ),
      itemSpacing: _logicalSize(object['gap'], '$path.gap'),
      unavailableFallback: _unavailableProductFallback(
        object['unavailableFallback'],
        '$path.unavailableFallback',
      ),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      direction: direction == 'vertical'
          ? MosaicProductSelectorDirection.vertical
          : MosaicProductSelectorDirection.horizontal,
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      appearance: _v03OptionalAppearance(object, path),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicProductCardComponent _v03ProductCard(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'productReferenceId',
        'direction',
        'gap',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
        'styles',
      },
      path,
      optional: const <String>{'clipContent', 'accessibility', 'sizing'},
    );
    _expectConst(object['type'], 'productCard', '$path.type');
    if (object.containsKey('clipContent') &&
        _boolean(object['clipContent'], '$path.clipContent')) {
      throw MosaicProtocolException(
        'Product Card clipContent must be false at $path.clipContent.',
      );
    }
    final children = _nonEmptyList(object['children'], '$path.children');
    return MosaicProductCardComponent(
      id: _identifier(object['id'], '$path.id'),
      productReferenceId: _identifier(
        object['productReferenceId'],
        '$path.productReferenceId',
      ),
      direction: _v03StackDirection(object['direction'], '$path.direction'),
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
          _v03ProductCardChild(children[index], '$path.children[$index]'),
      ],
      styles: _v03SelectionStyles(object['styles'], '$path.styles'),
      accessibilityLabel: object.containsKey('accessibility')
          ? _v03ProductCardAccessibility(
              object['accessibility'],
              '$path.accessibility',
            )
          : null,
      sizing: _v03OptionalSizing(object, path),
    );
  }

  MosaicLocalizedText _v03ProductCardAccessibility(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'label'}, path);
    return _localizedText(object['label'], '$path.label');
  }

  MosaicNode _v03ProductCardChild(Object? value, String path) {
    final object = _object(value, path);
    if (object['type'] == 'productBadge') {
      return _v03ProductBadge(object, path);
    }
    return _v03ProductCardPassiveNode(object, path);
  }

  MosaicProductBadgeComponent _v03ProductBadge(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'placement',
        'direction',
        'gap',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
        'styles',
      },
      path,
      optional: const <String>{'sizing'},
    );
    _expectConst(object['type'], 'productBadge', '$path.type');
    final children = _nonEmptyList(object['children'], '$path.children');
    if (children.length > 10) {
      throw MosaicProtocolException(
        'Product Badge children must contain at most 10 entries at '
        '$path.children.',
      );
    }
    return MosaicProductBadgeComponent(
      id: _identifier(object['id'], '$path.id'),
      placement: _v03ProductBadgePlacement(
        object['placement'],
        '$path.placement',
      ),
      direction: _v03StackDirection(object['direction'], '$path.direction'),
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
          _v03ProductCardPassiveNode(
            children[index],
            '$path.children[$index]',
          ),
      ],
      styles: _v03SelectionStyles(object['styles'], '$path.styles'),
      sizing: _v03OptionalSizing(object, path),
    );
  }

  MosaicProductBadgePlacement _v03ProductBadgePlacement(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    final mode = _enumValue(
      object['mode'],
      const <String>{'nested', 'overlay'},
      '$path.mode',
    );
    if (mode == 'nested') {
      _expectKeys(object, const <String>{'mode'}, path);
      return const MosaicNestedProductBadgePlacement();
    }
    _expectKeys(object, const <String>{'mode', 'anchor', 'inset'}, path);
    final anchor = _enumValue(
      object['anchor'],
      const <String>{'topStart', 'topEnd', 'bottomStart', 'bottomEnd'},
      '$path.anchor',
    );
    return MosaicOverlayProductBadgePlacement(
      anchor: MosaicProductBadgeAnchor.values.byName(anchor),
      inset: _boundedNumber(
        object['inset'],
        '$path.inset',
        minimum: 0,
        maximum: 64,
      ),
    );
  }

  MosaicNode _v03ProductCardPassiveNode(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'stack' => _v03ProductCardPassiveStack(object, path),
      'text' => _v03Text(object, path),
      'image' => _v03Image(object, path),
      'icon' => _v03Icon(object, path),
      'featureList' => _v03FeatureList(object, path),
      'countdown' => _v03Countdown(object, path),
      _ => throw MosaicProtocolException(
          'Product Card content must be passive; found "$type" at '
          '$path.type.',
        ),
    };
  }

  MosaicStackComponent _v03ProductCardPassiveStack(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'direction',
        'gap',
        'padding',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
      },
      path,
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    _expectConst(object['type'], 'stack', '$path.type');
    final children = _list(object['children'], '$path.children');
    return MosaicStackComponent(
      id: _identifier(object['id'], '$path.id'),
      direction: _v03StackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      padding: _edgeInsets(object['padding'], '$path.padding'),
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
          _v03ProductCardPassiveNode(
            children[index],
            '$path.children[$index]',
          ),
      ],
      appearance: _v03OptionalAppearance(object, path, container: true),
      sizing: _v03OptionalSizing(object, path),
      outerInsets: _v03OptionalInsets(object, path, 'outerInsets'),
      visibility: _v03OptionalVisibility(object, path),
    );
  }

  MosaicStackDirection _v03StackDirection(Object? value, String path) =>
      switch (_enumValue(
        value,
        const <String>{'vertical', 'horizontal'},
        path,
      )) {
        'vertical' => MosaicStackDirection.vertical,
        'horizontal' => MosaicStackDirection.horizontal,
        final unreachable =>
          throw StateError('Unhandled stack direction "$unreachable".'),
      };
}
