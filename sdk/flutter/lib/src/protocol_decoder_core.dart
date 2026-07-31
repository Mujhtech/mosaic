part of 'protocol.dart';

extension on MosaicProtocolDecoder {
  MosaicPaywallDocument _decodeV02(Map<String, Object?> root) {
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
        'Protocol 0.2 screens must contain between 1 and 10 entries.',
      );
    }
    final screens = <MosaicPaywallScreen>[
      for (var index = 0; index < screenValues.length; index += 1)
        _v02Screen(screenValues[index], '\$.screens[$index]'),
    ];
    if (screens.length > 1 &&
        screens.any((screen) => screen.accessibilityLabel == null)) {
      throw const MosaicProtocolException(
        'Every Protocol 0.2 Paywall Screen must have an accessibilityLabel '
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
      schemaVersion: mosaicProtocolV02Version,
      id: _identifier(root['id'], r'$.id'),
      revision: _positiveInteger(root['revision'], r'$.revision'),
      compatibility: _compatibilityFor(
        root['compatibility'],
        version: mosaicProtocolV02Version,
        supported: mosaicProtocolV02Capabilities,
      ),
      localization: _localization(root['localization']),
      designSystem: _v02DesignSystem(root['designSystem']),
      assets: _v02Assets(root['assets']),
      products: _v02Products(root['products']),
      layout: initialScreen.single.layout,
      initialScreenId: initialScreenId,
      screens: screens,
    );
    _validateDocumentSemantics(document);
    return document;
  }

  MosaicPaywallScreen _v02Screen(Object? value, String path) {
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
      presentation: _v02ScreenPresentation(
        object['presentation'],
        '$path.presentation',
      ),
      layout: _v02ScrollContainer(object['layout'], '$path.layout'),
    );
  }

  MosaicScreenPresentation _v02ScreenPresentation(
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
        throw MosaicProtocolException(
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

  MosaicScrollContainer _v02ScrollContainer(Object? value, String path) {
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
      content: _v02Stack(object['content'], '$path.content'),
      background: object.containsKey('background')
          ? _v02Background(object['background'], '$path.background')
          : null,
    );
  }

  MosaicStackComponent _v02Stack(Object? value, String path) {
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
      direction: switch (_enumValue(
        object['direction'],
        const <String>{'vertical', 'horizontal'},
        '$path.direction',
      )) {
        'vertical' => MosaicStackDirection.vertical,
        _ => MosaicStackDirection.horizontal,
      },
      gap: _logicalSize(object['gap'], '$path.gap'),
      padding: _edgeInsets(object['padding'], '$path.padding'),
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

  MosaicNode _v02Node(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'stack' => _v02Stack(object, path),
      'text' => _v02Text(object, path),
      'image' => _v02Image(object, path),
      'featureList' => _v02FeatureList(object, path),
      'productSelector' => _v02ProductSelector(object, path),
      'button' => _v02Button(object, path),
      'icon' => _v02Icon(object, path),
      'carousel' => _v02Carousel(object, path),
      'switch' => _v02Switch(object, path),
      'countdown' => _v02Countdown(object, path),
      _ => throw MosaicProtocolException(
          'Unsupported component type "$type" at $path.type.',
        ),
    };
  }

  MosaicTextComponent _v02Text(Map<String, Object?> object, String path) {
    _expectV02ComponentKeys(
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
    final typography = _v02Typography(
      object['typography'],
      '$path.typography',
      allowMaximumLines: true,
    );
    return MosaicTextComponent(
      id: _identifier(object['id'], '$path.id'),
      value: _localizedText(object['value'], '$path.value'),
      style: typography.style,
      alignment: typography.alignment,
      accessibility: _v02TextAccessibility(
        object['accessibility'],
        '$path.accessibility',
        allowHeading: true,
      ),
      typography: typography,
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicImageComponent _v02Image(Map<String, Object?> object, String path) {
    _expectV02ComponentKeys(
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
      sizing: _v02OptionalSizing(object, path),
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
      appearance: _v02OptionalAppearance(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicFeatureListComponent _v02FeatureList(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
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
    final typography = _v02Typography(
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
      markerColor: _v02Color(object['markerColor'], '$path.markerColor'),
      typography: typography,
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicProductSelectorComponent _v02ProductSelector(
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
          _v02ProductCard(cardValues[index], '$path.cards[$index]'),
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
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicProductCardComponent _v02ProductCard(Object? value, String path) {
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
      direction: _v02StackDirection(object['direction'], '$path.direction'),
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
          _v02ProductCardChild(children[index], '$path.children[$index]'),
      ],
      styles: _v02ProductCardStyles(object['styles'], '$path.styles'),
      accessibilityLabel: object.containsKey('accessibility')
          ? _v02ProductCardAccessibility(
              object['accessibility'],
              '$path.accessibility',
            )
          : null,
      sizing: _v02OptionalSizing(object, path),
    );
  }

  MosaicLocalizedText _v02ProductCardAccessibility(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'label'}, path);
    return _localizedText(object['label'], '$path.label');
  }

  MosaicNode _v02ProductCardChild(Object? value, String path) {
    final object = _object(value, path);
    if (object['type'] == 'productBadge') {
      return _v02ProductBadge(object, path);
    }
    return _v02ProductCardPassiveNode(object, path);
  }

  MosaicProductBadgeComponent _v02ProductBadge(
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
      placement: _v02ProductBadgePlacement(
        object['placement'],
        '$path.placement',
      ),
      direction: _v02StackDirection(object['direction'], '$path.direction'),
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
          _v02ProductCardPassiveNode(
            children[index],
            '$path.children[$index]',
          ),
      ],
      styles: _v02ProductCardStyles(object['styles'], '$path.styles'),
      sizing: _v02OptionalSizing(object, path),
    );
  }

  MosaicProductBadgePlacement _v02ProductBadgePlacement(
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

  MosaicNode _v02ProductCardPassiveNode(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'stack' => _v02ProductCardPassiveStack(object, path),
      'text' => _v02Text(object, path),
      'image' => _v02Image(object, path),
      'icon' => _v02Icon(object, path),
      'featureList' => _v02FeatureList(object, path),
      'countdown' => _v02Countdown(object, path),
      _ => throw MosaicProtocolException(
          'Product Card content must be passive; found "$type" at '
          '$path.type.',
        ),
    };
  }

  MosaicStackComponent _v02ProductCardPassiveStack(
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
      direction: _v02StackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      padding: _edgeInsets(object['padding'], '$path.padding'),
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
          _v02ProductCardPassiveNode(
            children[index],
            '$path.children[$index]',
          ),
      ],
      appearance: _v02OptionalAppearance(object, path, container: true),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicStackDirection _v02StackDirection(Object? value, String path) =>
      _enumValue(value, const <String>{'vertical', 'horizontal'}, path) ==
              'vertical'
          ? MosaicStackDirection.vertical
          : MosaicStackDirection.horizontal;
}
