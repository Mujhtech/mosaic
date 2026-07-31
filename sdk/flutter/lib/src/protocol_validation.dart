part of 'protocol.dart';

void _validateDocumentSemantics(MosaicPaywallDocument document) {
  final nodes = document.nodes.toList(growable: false);
  _requireUnique(
    nodes.map((node) => node.id),
    'layout tree node identifier',
  );

  for (final node in nodes.whereType<MosaicFeatureListComponent>()) {
    _requireUnique(
      node.items.map((item) => item.id),
      'feature item identifier in ${node.id}',
    );
  }
  if (document.schemaVersion == mosaicProtocolV02Version) {
    if (document.designSystem == null) {
      throw const MosaicProtocolException(
        'Protocol 0.2 requires a document design system.',
      );
    }
    _requireUnique(
      document.screens.map((screen) => screen.id),
      'Paywall Screen identifier',
    );
    if (document.initialScreen?.presentation !=
        MosaicScreenPresentation.screen) {
      throw const MosaicProtocolException(
        'Protocol 0.2 initial screen must use Screen presentation.',
      );
    }
    _validateV02DesignSystem(document);
    for (final screen in document.screens) {
      if (screen.layout.content is! MosaicStackComponent ||
          (screen.layout.content as MosaicStackComponent).direction !=
              MosaicStackDirection.vertical) {
        throw MosaicProtocolException(
          'Protocol 0.2 screen ${screen.id} root scroll content must be a '
          'vertical Stack.',
        );
      }
      if (screen.layout.content.children.isEmpty) {
        throw MosaicProtocolException(
          'Protocol 0.2 screen ${screen.id} root Stack must contain at least '
          'one child.',
        );
      }
    }
    final pageIds = <String>[];
    for (final carousel in nodes.whereType<MosaicCarouselComponent>()) {
      if (carousel.initialPageIndex >= carousel.pages.length) {
        throw MosaicProtocolException(
          'Carousel ${carousel.id} initialPageIndex does not reference a page.',
        );
      }
      pageIds.addAll(carousel.pages.map((page) => page.id));
    }
    _requireUnique(
      <String>[...nodes.map((node) => node.id), ...pageIds],
      'layout tree node or Carousel page identifier',
    );
    _validateV02RuntimeSemantics(document);
  }

  _requireUnique(
    document.assets.map((asset) => asset.id),
    'asset identifier',
  );
  _requireUnique(
    document.products.map((product) => product.id),
    'product reference identifier',
  );
  _requireUnique(
    document.products.map((product) => product.productId),
    'provider product identifier',
  );

  final assetsById = <String, MosaicAsset>{
    for (final asset in document.assets) asset.id: asset,
  };
  final referencedAssets = <String>{};
  for (final image in nodes.whereType<MosaicImageComponent>()) {
    if (assetsById[image.assetId] is! MosaicImageAsset) {
      throw MosaicProtocolException(
        'Image ${image.id} must reference an image asset ${image.assetId}.',
      );
    }
    referencedAssets.add(image.assetId);
  }
  if (document.schemaVersion == mosaicProtocolV02Version) {
    for (final background in _allV02Backgrounds(document)) {
      final resolved = document.resolveBackground(background);
      switch (resolved) {
        case MosaicImageBackground():
          if (assetsById[resolved.assetId] is! MosaicImageAsset) {
            throw MosaicProtocolException(
              'Image background must reference image asset ${resolved.assetId}.',
            );
          }
          referencedAssets.add(resolved.assetId);
        case MosaicVideoBackground():
          if (assetsById[resolved.assetId] is! MosaicVideoAsset) {
            throw MosaicProtocolException(
              'Video background must reference video asset ${resolved.assetId}.',
            );
          }
          referencedAssets.add(resolved.assetId);
          if (resolved.posterAssetId case final poster?) {
            if (assetsById[poster] is! MosaicImageAsset) {
              throw MosaicProtocolException(
                'Video poster must reference image asset $poster.',
              );
            }
            referencedAssets.add(poster);
          }
        default:
          break;
      }
    }
  }
  for (final asset in document.assets) {
    if (!referencedAssets.contains(asset.id)) {
      throw MosaicProtocolException('Asset ${asset.id} is unused.');
    }
  }

  final productsById = <String, MosaicProductReference>{
    for (final product in document.products) product.id: product,
  };
  final referencedProducts = <String>{};
  final selectors = <String, MosaicProductSelectorComponent>{};
  for (final selector in nodes.whereType<MosaicProductSelectorComponent>()) {
    selectors[selector.id] = selector;
    final referenceIds = selector.cards.isEmpty
        ? selector.productReferenceIds
        : selector.cards
            .map((card) => card.productReferenceId)
            .toList(growable: false);
    if (selector.cards.isNotEmpty &&
        referenceIds.toSet().length != referenceIds.length) {
      throw MosaicProtocolException(
        'Product selector ${selector.id} contains duplicate product '
        'reference bindings.',
      );
    }
    for (final referenceId in referenceIds) {
      if (!productsById.containsKey(referenceId)) {
        throw MosaicProtocolException(
          'Product selector ${selector.id} references unknown product '
          '$referenceId.',
        );
      }
      referencedProducts.add(referenceId);
    }
    if (selector.cards.isEmpty) {
      if (!selector.productReferenceIds
          .contains(selector.initiallySelectedProductReferenceId)) {
        throw MosaicProtocolException(
          'Product selector ${selector.id} initially selects an undeclared '
          'product.',
        );
      }
    } else {
      if (!selector.cards
          .any((card) => card.id == selector.initialProductCardId)) {
        throw MosaicProtocolException(
          'Product selector ${selector.id} initially selects an undeclared '
          'Product Card.',
        );
      }
      for (final card in selector.cards) {
        _validateProductCardStructure(card);
      }
    }
  }

  final selectorsWithPurchaseActions = <String>{};
  final purchaseActions = <({String buttonId, MosaicPurchaseAction action})>[
    for (final button in nodes.whereType<MosaicPurchaseButtonComponent>())
      (buttonId: button.id, action: button.action),
    for (final button in nodes.whereType<MosaicButtonComponent>())
      if (button.action case final MosaicPurchaseAction action)
        (buttonId: button.id, action: action),
  ];
  final screenByNodeId = document.schemaVersion == mosaicProtocolV02Version
      ? _v02ScreenByNodeId(document)
      : const <String, String>{};
  for (final entry in purchaseActions) {
    final selectorId = entry.action.productSelectorId;
    if (!selectors.containsKey(selectorId)) {
      throw MosaicProtocolException(
        'Purchase button ${entry.buttonId} references unknown product selector '
        '$selectorId.',
      );
    }
    if (document.schemaVersion == mosaicProtocolV02Version &&
        screenByNodeId[entry.buttonId] != screenByNodeId[selectorId]) {
      throw MosaicProtocolException(
        'Purchase Button ${entry.buttonId} must reference a Product Selector '
        'in the same Paywall Screen.',
      );
    }
    selectorsWithPurchaseActions.add(selectorId);
  }
  for (final selector in selectors.values) {
    if (!selectorsWithPurchaseActions.contains(selector.id)) {
      throw MosaicProtocolException(
        'Product selector ${selector.id} has no purchase action.',
      );
    }
  }
  for (final product in document.products) {
    if (!referencedProducts.contains(product.id)) {
      throw MosaicProtocolException('Product ${product.id} is unused.');
    }
  }

  _validateLocalizationSemantics(document);
  _validateCapabilities(document, nodes);
}

void _validateProductCardStructure(MosaicProductCardComponent card) {
  final directBadges = card.children.whereType<MosaicProductBadgeComponent>();
  if (directBadges.length > 1) {
    throw MosaicProtocolException(
      'Product Card ${card.id} may contain at most one direct Product Badge.',
    );
  }

  var descendantCount = 0;
  var maximumStackDepth = 0;
  void visit(MosaicNode node, int stackDepth) {
    descendantCount += 1;
    final nextDepth = node is MosaicStackNode ? stackDepth + 1 : stackDepth;
    if (nextDepth > maximumStackDepth) maximumStackDepth = nextDepth;
    final children = switch (node) {
      MosaicStackNode() => node.children,
      MosaicProductBadgeComponent() => node.children,
      _ => const <MosaicNode>[],
    };
    for (final child in children) {
      visit(child, nextDepth);
    }
  }

  for (final child in card.children) {
    visit(child, 0);
  }
  if (descendantCount > 20) {
    throw MosaicProtocolException(
      'Product Card ${card.id} exceeds 20 passive descendants.',
    );
  }
  if (maximumStackDepth > 4) {
    throw MosaicProtocolException(
      'Product Card ${card.id} exceeds nested Stack depth 4.',
    );
  }
}

void _validateV02DesignSystem(MosaicPaywallDocument document) {
  final designSystem = document.designSystem!;
  for (final category in <Iterable<({String id, String name})>>[
    designSystem.colors.map((token) => (id: token.id, name: token.name)),
    designSystem.backgrounds.map((token) => (id: token.id, name: token.name)),
    designSystem.shadows.map((token) => (id: token.id, name: token.name)),
  ]) {
    _requireUnique(
        category.map((token) => token.id), 'design token identifier');
    _requireUnique(category.map((token) => token.name), 'design token name');
  }

  for (final color in _allV02Colors(document)) {
    document.resolveColor(color);
  }
  for (final background in _allV02Backgrounds(document)) {
    final resolved = document.resolveBackground(background);
    for (final color in _backgroundColors(resolved)) {
      document.resolveColor(color);
    }
  }
  for (final shadow in _allV02Shadows(document)) {
    final resolved = document.resolveShadow(shadow);
    document.resolveColor(resolved.color);
  }
}

Iterable<MosaicBackground> _allV02Backgrounds(
  MosaicPaywallDocument document,
) sync* {
  yield* document.designSystem!.backgrounds.map((token) => token.value);
  for (final screen in document.screens) {
    if (screen.layout.background case final background?) yield background;
  }
  for (final node in document.nodes) {
    if (_nodeAppearance(node)?.background case final background?) {
      yield background;
    }
    if (node is MosaicProductCardComponent) {
      yield node.styles.defaultStyle.background;
      if (node.styles.selectedOverride.background case final background?) {
        yield background;
      }
    } else if (node is MosaicProductBadgeComponent) {
      yield node.styles.defaultStyle.background;
      if (node.styles.selectedOverride.background case final background?) {
        yield background;
      }
    }
  }
}

Iterable<MosaicShadow> _allV02Shadows(MosaicPaywallDocument document) sync* {
  yield* document.designSystem!.shadows.map((token) => token.value);
  for (final node in document.nodes) {
    if (_nodeAppearance(node)?.shadow case final shadow?) yield shadow;
    if (node is MosaicProductCardComponent) {
      if (node.styles.defaultStyle.shadow case final shadow?) yield shadow;
      if (node.styles.selectedOverride.shadow case final shadow?) yield shadow;
    } else if (node is MosaicProductBadgeComponent) {
      if (node.styles.defaultStyle.shadow case final shadow?) yield shadow;
      if (node.styles.selectedOverride.shadow case final shadow?) yield shadow;
    }
  }
}

Iterable<MosaicColorValue> _backgroundColors(
    MosaicBackground background) sync* {
  switch (background) {
    case MosaicColorBackground():
      yield background.color;
    case MosaicLinearGradientBackground():
      yield* background.stops.map((stop) => stop.color);
    case MosaicRadialGradientBackground():
      yield* background.stops.map((stop) => stop.color);
    case MosaicImageBackground():
      yield background.fallbackColor;
    case MosaicVideoBackground():
      yield background.fallbackColor;
    case MosaicBackgroundTokenReference():
      break;
  }
}

Iterable<MosaicColorValue> _allV02Colors(MosaicPaywallDocument document) sync* {
  yield* document.designSystem!.colors.map((token) => token.value);
  for (final background in _allV02Backgrounds(document)) {
    yield* _backgroundColors(document.resolveBackground(background));
  }
  for (final node in document.nodes) {
    final appearance = _nodeAppearance(node);
    if (appearance?.border?.color case final color?) yield color;
    if (_nodeTypography(node)?.color case final color?) yield color;
    switch (node) {
      case MosaicFeatureListComponent():
        if (node.markerColor case final color?) yield color;
      case MosaicIconComponent():
        yield node.color;
      case MosaicSwitchComponent():
        yield node.offTrackColor;
        yield node.onTrackColor;
        yield node.thumbColor;
      case MosaicProductCardComponent():
        yield node.styles.defaultStyle.border.color;
        if (node.styles.selectedOverride.borderColor case final color?) {
          yield color;
        }
      case MosaicProductBadgeComponent():
        yield node.styles.defaultStyle.border.color;
        if (node.styles.selectedOverride.borderColor case final color?) {
          yield color;
        }
      default:
        break;
    }
  }
}

void _validateV02RuntimeSemantics(MosaicPaywallDocument document) {
  final screenByNodeId = _v02ScreenByNodeId(document);
  final switches = <String, MosaicSwitchComponent>{
    for (final node in document.nodes.whereType<MosaicSwitchComponent>())
      node.id: node,
  };

  void validateButtonChildren(
    MosaicButtonComponent button,
    Iterable<MosaicNode> children,
  ) {
    void visitChild(MosaicNode child) {
      if (child is MosaicButtonComponent ||
          child is MosaicProductSelectorComponent ||
          child is MosaicSwitchComponent ||
          child is MosaicCarouselComponent) {
        throw MosaicProtocolException(
          'Button ${button.id} cannot contain interactive descendant '
          '${child.type} ${child.id}.',
        );
      }
      if (child is MosaicStackNode) {
        for (final descendant in child.children) {
          visitChild(descendant);
        }
      }
    }

    for (final child in children) {
      visitChild(child);
    }
  }

  for (final button in document.nodes.whereType<MosaicButtonComponent>()) {
    validateButtonChildren(button, button.children);
    if (button.inProgressChildren case final inProgress?) {
      validateButtonChildren(button, inProgress);
    }
  }

  void visit(MosaicNode node, {required bool insideCarousel}) {
    final visibility = _nodeVisibility(node);
    if (visibility is MosaicSwitchVisibility) {
      if (!switches.containsKey(visibility.switchId)) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility references unknown switch '
          '${visibility.switchId}.',
        );
      }
      if (visibility.switchId == node.id) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility cannot reference itself.',
        );
      }
      if (screenByNodeId[visibility.switchId] != screenByNodeId[node.id]) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility must reference a Switch in the '
          'same Paywall Screen.',
        );
      }
    }
    switch (node) {
      case MosaicStackNode():
        for (final child in node.children) {
          visit(child, insideCarousel: insideCarousel);
        }
      case MosaicCarouselComponent():
        if (insideCarousel) {
          throw MosaicProtocolException(
            'Carousel ${node.id} cannot be nested inside another Carousel.',
          );
        }
        for (final page in node.pages) {
          visit(page.content, insideCarousel: true);
        }
      case MosaicButtonComponent():
        for (final child in node.children) {
          visit(child, insideCarousel: insideCarousel);
        }
        if (node.inProgressChildren case final inProgress?) {
          for (final child in inProgress) {
            visit(child, insideCarousel: insideCarousel);
          }
        }
      case MosaicProductSelectorComponent():
        for (final card in node.cards) {
          visit(card, insideCarousel: insideCarousel);
        }
      case MosaicProductCardComponent():
        for (final child in node.children) {
          visit(child, insideCarousel: insideCarousel);
        }
      case MosaicProductBadgeComponent():
        for (final child in node.children) {
          visit(child, insideCarousel: insideCarousel);
        }
      default:
        break;
    }
  }

  for (final screen in document.screens) {
    visit(screen.layout.content, insideCarousel: false);
  }

  final screenIds = document.screens.map((screen) => screen.id).toSet();
  final forwardEdges = <String, Set<String>>{
    for (final screen in document.screens) screen.id: <String>{},
  };
  for (final button in document.nodes.whereType<MosaicButtonComponent>()) {
    if (button.action case final MosaicNavigateToAction action) {
      final sourceScreen = screenByNodeId[button.id]!;
      if (!screenIds.contains(action.screenId)) {
        throw MosaicProtocolException(
          'Button ${button.id} navigateTo references unknown Paywall Screen '
          '${action.screenId}.',
        );
      }
      if (sourceScreen == action.screenId) {
        throw MosaicProtocolException(
          'Button ${button.id} cannot navigateTo its own Paywall Screen.',
        );
      }
      forwardEdges[sourceScreen]!.add(action.screenId);
    }
  }

  final visited = <String>{};
  final active = <String>{};
  void visitGraph(String screenId) {
    if (!active.add(screenId)) {
      throw const MosaicProtocolException(
        'Protocol 0.2 navigateTo graph must be acyclic.',
      );
    }
    if (visited.add(screenId)) {
      for (final target in forwardEdges[screenId]!) {
        visitGraph(target);
      }
    }
    active.remove(screenId);
  }

  visitGraph(document.initialScreenId!);
  final unreachable = screenIds.difference(visited);
  if (unreachable.isNotEmpty) {
    throw MosaicProtocolException(
      'Protocol 0.2 contains unreachable Paywall Screens: '
      '${unreachable.join(', ')}.',
    );
  }
}

Map<String, String> _v02ScreenByNodeId(MosaicPaywallDocument document) {
  final result = <String, String>{};
  for (final screen in document.screens) {
    result[screen.layout.id] = screen.id;
    for (final node
        in MosaicPaywallDocument._walkStack(screen.layout.content)) {
      result[node.id] = screen.id;
    }
  }
  return result;
}
