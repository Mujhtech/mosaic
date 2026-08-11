part of 'protocol.dart';

/// Which motion triggers a node may carry.
///
/// The partition is the contract's, not a convenience: `appear` on any node
/// except the screen Scroll Container, `selection` on the two components that
/// own runtime selection state, `loop` on Button alone.
enum _MotionSlot {
  /// The screen Scroll Container, which is viewport-owned rather than
  /// authored — the same reason `0.3` excludes it from `sizing`.
  none,
  node,
  selectable,
  button,
}

/// One decode of one document, bound to the schema version it declared.
///
/// The version is carried as receiver state rather than threaded through every
/// helper because almost every decoding rule is shared: `0.4` is `0.3` plus
/// motion, minus one co-derived capability, with one consolidated marker
/// vocabulary. Passing a version parameter into eighty helpers would make the
/// three differences invisible among the identical arguments.
final class _DocumentDecoder {
  const _DocumentDecoder(this.schemaVersion);

  final String schemaVersion;

  /// Whether this document is read under Paywall Protocol 0.4.
  bool get isV04 => schemaVersion == mosaicProtocolVersionV04;

  /// The capabilities a document of this version may declare.
  Set<String> get supportedCapabilities =>
      isV04 ? mosaicProtocolV04Capabilities : mosaicProtocolV03Capabilities;

  MosaicPaywallDocument _decodeDocument(Map<String, Object?> root) {
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
        _docScreen(screenValues[index], '\$.screens[$index]'),
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
      schemaVersion: schemaVersion,
      id: _identifier(root['id'], r'$.id'),
      revision: _positiveInteger(root['revision'], r'$.revision'),
      compatibility: _compatibilityFor(
        root['compatibility'],
        version: schemaVersion,
        supported: supportedCapabilities,
      ),
      localization: _localization(root['localization']),
      designSystem: _docDesignSystem(root['designSystem']),
      assets: _docAssets(root['assets']),
      products: _docProducts(root['products']),
      layout: initialScreen.single.layout,
      initialScreenId: initialScreenId,
      screens: screens,
    );
    _validateDocumentSemantics(document);
    return document;
  }

  MosaicPaywallScreen _docScreen(Object? value, String path) {
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
      presentation: _docScreenPresentation(
        object['presentation'],
        '$path.presentation',
      ),
      layout: _docScrollContainer(object['layout'], '$path.layout'),
    );
  }

  MosaicScreenPresentation _docScreenPresentation(
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

  MosaicScrollContainer _docScrollContainer(Object? value, String path) {
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
      content: _docStack(object['content'], '$path.content'),
      background: object.containsKey('background')
          ? _docBackground(object['background'], '$path.background')
          : null,
    );
  }

  MosaicStackComponent _docStack(Object? value, String path) {
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
      optional: <String>{
        if (isV04) 'motion',
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
      direction: _docStackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      padding: _edgeInsets(object['padding'], '$path.padding'),
      mainAxisDistribution: _docDistribution(
        object['mainAxisDistribution'],
        '$path.mainAxisDistribution',
      ),
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      children: <MosaicNode>[
        for (var index = 0; index < children.length; index += 1)
          _docNode(children[index], '$path.children[$index]'),
      ],
      appearance: _docOptionalAppearance(
        object,
        path,
        container: true,
      ),
      sizing: _docOptionalSizing(object, path),
      outerInsets: _docOptionalInsets(object, path, 'outerInsets'),
      visibility: _docOptionalVisibility(object, path),
      motion: _nodeMotion(object, path, _MotionSlot.node),
    );
  }

  MosaicNode _docNode(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'stack' => _docStack(object, path),
      'text' => _docText(object, path),
      'image' => _docImage(object, path),
      'featureList' => _docFeatureList(object, path),
      'productSelector' => _docProductSelector(object, path),
      'button' => _docButton(object, path),
      'icon' => _docIcon(object, path),
      'carousel' => _docCarousel(object, path),
      'switch' => _docSwitch(object, path),
      'countdown' => _docCountdown(object, path),
      'tabs' => _docTabs(object, path),
      'timeline' => _docTimeline(object, path),
      'award' => _docAward(object, path),
      'socialProof' => _docSocialProof(object, path),
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

  MosaicTextComponent _docText(Map<String, Object?> object, String path) {
    _expectComponentKeys(
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
      motion: _MotionSlot.selectable,
    );
    final typography = _docTypography(
      object['typography'],
      '$path.typography',
      allowMaximumLines: true,
    );
    return MosaicTextComponent(
      id: _identifier(object['id'], '$path.id'),
      value: _localizedText(object['value'], '$path.value'),
      style: typography.style,
      alignment: typography.alignment,
      accessibility: _docTextAccessibility(
        object['accessibility'],
        '$path.accessibility',
        allowHeading: true,
      ),
      typography: typography,
      appearance: _docOptionalAppearance(object, path),
      sizing: _docOptionalSizing(object, path),
      outerInsets: _docOptionalInsets(object, path, 'outerInsets'),
      visibility: _docOptionalVisibility(object, path),
      motion: _nodeMotion(object, path, _MotionSlot.node),
    );
  }

  MosaicImageComponent _docImage(Map<String, Object?> object, String path) {
    _expectComponentKeys(
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
      sizing: _docOptionalSizing(object, path),
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
      appearance: _docOptionalAppearance(object, path),
      outerInsets: _docOptionalInsets(object, path, 'outerInsets'),
      visibility: _docOptionalVisibility(object, path),
      motion: _nodeMotion(object, path, _MotionSlot.node),
    );
  }

  MosaicFeatureListComponent _docFeatureList(
    Map<String, Object?> object,
    String path,
  ) {
    _expectComponentKeys(
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
    // 0.3 has one constant glyph and cannot express a negated item; 0.4
    // consolidates onto the union Timeline already used. The 0.3 constant means
    // exactly the checkmark icon arm of that union, so both versions decode
    // into one field and the renderer needs no version branch.
    final marker = isV04
        ? _marker(object['marker'], '$path.marker')
        : () {
            _expectConst(object['marker'], 'checkmark', '$path.marker');
            return const MosaicIconMarker(MosaicIconName.checkmark);
          }();
    final items = _nonEmptyList(object['items'], '$path.items');
    final typography = _docTypography(
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
      marker: marker,
      markerColor: _docColor(object['markerColor'], '$path.markerColor'),
      typography: typography,
      appearance: _docOptionalAppearance(object, path),
      sizing: _docOptionalSizing(object, path),
      outerInsets: _docOptionalInsets(object, path, 'outerInsets'),
      visibility: _docOptionalVisibility(object, path),
      motion: _nodeMotion(object, path, _MotionSlot.node),
    );
  }

  MosaicProductSelectorComponent _docProductSelector(
    Map<String, Object?> object,
    String path,
  ) {
    _expectComponentKeys(
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
          _docProductCard(cardValues[index], '$path.cards[$index]'),
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
      appearance: _docOptionalAppearance(object, path),
      sizing: _docOptionalSizing(object, path),
      outerInsets: _docOptionalInsets(object, path, 'outerInsets'),
      visibility: _docOptionalVisibility(object, path),
      motion: _nodeMotion(object, path, _MotionSlot.selectable),
    );
  }

  MosaicProductCardComponent _docProductCard(Object? value, String path) {
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
      optional: <String>{
        if (isV04) 'motion',
        'clipContent',
        'accessibility',
        'sizing'
      },
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
      direction: _docStackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      mainAxisDistribution: _docDistribution(
        object['mainAxisDistribution'],
        '$path.mainAxisDistribution',
      ),
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      children: <MosaicNode>[
        for (var index = 0; index < children.length; index += 1)
          _docProductCardChild(children[index], '$path.children[$index]'),
      ],
      styles: _docSelectionStyles(object['styles'], '$path.styles'),
      accessibilityLabel: object.containsKey('accessibility')
          ? _docProductCardAccessibility(
              object['accessibility'],
              '$path.accessibility',
            )
          : null,
      sizing: _docOptionalSizing(object, path),
      motion: _nodeMotion(object, path, _MotionSlot.node),
    );
  }

  MosaicLocalizedText _docProductCardAccessibility(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'label'}, path);
    return _localizedText(object['label'], '$path.label');
  }

  MosaicNode _docProductCardChild(Object? value, String path) {
    final object = _object(value, path);
    if (object['type'] == 'productBadge') {
      return _docProductBadge(object, path);
    }
    return _docProductCardPassiveNode(object, path);
  }

  MosaicProductBadgeComponent _docProductBadge(
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
      optional: <String>{if (isV04) 'motion', 'sizing'},
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
      placement: _docProductBadgePlacement(
        object['placement'],
        '$path.placement',
      ),
      direction: _docStackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      mainAxisDistribution: _docDistribution(
        object['mainAxisDistribution'],
        '$path.mainAxisDistribution',
      ),
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      children: <MosaicNode>[
        for (var index = 0; index < children.length; index += 1)
          _docProductCardPassiveNode(
            children[index],
            '$path.children[$index]',
          ),
      ],
      styles: _docSelectionStyles(object['styles'], '$path.styles'),
      sizing: _docOptionalSizing(object, path),
      motion: _nodeMotion(object, path, _MotionSlot.node),
    );
  }

  MosaicProductBadgePlacement _docProductBadgePlacement(
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

  MosaicNode _docProductCardPassiveNode(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'stack' => _docProductCardPassiveStack(object, path),
      'text' => _docText(object, path),
      'image' => _docImage(object, path),
      'icon' => _docIcon(object, path),
      'featureList' => _docFeatureList(object, path),
      'countdown' => _docCountdown(object, path),
      _ => throw MosaicProtocolException(
          'Product Card content must be passive; found "$type" at '
          '$path.type.',
        ),
    };
  }

  MosaicStackComponent _docProductCardPassiveStack(
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
      optional: <String>{
        if (isV04) 'motion',
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
      direction: _docStackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
      padding: _edgeInsets(object['padding'], '$path.padding'),
      mainAxisDistribution: _docDistribution(
        object['mainAxisDistribution'],
        '$path.mainAxisDistribution',
      ),
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      children: <MosaicNode>[
        for (var index = 0; index < children.length; index += 1)
          _docProductCardPassiveNode(
            children[index],
            '$path.children[$index]',
          ),
      ],
      appearance: _docOptionalAppearance(object, path, container: true),
      sizing: _docOptionalSizing(object, path),
      outerInsets: _docOptionalInsets(object, path, 'outerInsets'),
      visibility: _docOptionalVisibility(object, path),
      motion: _nodeMotion(object, path, _MotionSlot.node),
    );
  }

  MosaicStackDirection _docStackDirection(Object? value, String path) =>
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
