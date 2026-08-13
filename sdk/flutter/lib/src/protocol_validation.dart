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
  if (document.designSystem == null) {
    throw const MosaicProtocolException(
      'Protocol 0.3 requires a document design system.',
    );
  }
  _requireUnique(
    document.screens.map((screen) => screen.id),
    'Paywall Screen identifier',
  );
  if (document.initialScreen?.presentation != MosaicScreenPresentation.screen) {
    throw const MosaicProtocolException(
      'Protocol 0.3 initial screen must use Screen presentation.',
    );
  }
  _validateV03DesignSystem(document);
  for (final screen in document.screens) {
    if (screen.layout.content.direction != MosaicStackDirection.vertical) {
      throw MosaicProtocolException(
        'Protocol 0.3 screen ${screen.id} root scroll content must be a '
        'vertical Stack.',
      );
    }
    if (screen.layout.content.children.isEmpty) {
      throw MosaicProtocolException(
        'Protocol 0.3 screen ${screen.id} root Stack must contain at least '
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
  // A tab id names a control, a panel, and the value a visibility condition
  // compares against, so it joins the one global layout id namespace.
  final tabIds = <String>[];
  for (final tabs in nodes.whereType<MosaicTabsComponent>()) {
    if (tabs.tab(tabs.initialTabId) == null) {
      throw MosaicProtocolException(
        'Tabs ${tabs.id} initialTabId must name one of its declared tabs.',
      );
    }
    tabIds.addAll(tabs.tabs.map((tab) => tab.id));
  }
  for (final timeline in nodes.whereType<MosaicTimelineComponent>()) {
    _requireUnique(
      timeline.entries.map((entry) => entry.id),
      'Timeline entry identifier in ${timeline.id}',
    );
  }
  _requireUnique(
    <String>[...nodes.map((node) => node.id), ...pageIds, ...tabIds],
    'layout tree node, Carousel page, or Tabs entry identifier',
  );
  _validateV03RuntimeSemantics(document);

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
  for (final award in nodes.whereType<MosaicAwardComponent>()) {
    if (award.emblem case final MosaicAwardImageEmblem emblem) {
      if (assetsById[emblem.assetId] is! MosaicImageAsset) {
        throw MosaicProtocolException(
          'Award ${award.id} emblem must reference an image asset '
          '${emblem.assetId}.',
        );
      }
      referencedAssets.add(emblem.assetId);
    }
  }
  for (final proof in nodes.whereType<MosaicSocialProofComponent>()) {
    if (proof.avatar case final avatar?) {
      if (assetsById[avatar.assetId] is! MosaicImageAsset) {
        throw MosaicProtocolException(
          'Social Proof ${proof.id} avatar must reference an image asset '
          '${avatar.assetId}.',
        );
      }
      referencedAssets.add(avatar.assetId);
    }
  }
  for (final background in _allV03Backgrounds(document)) {
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
    final referenceIds = selector.cards
        .map((card) => card.productReferenceId)
        .toList(growable: false);
    if (referenceIds.toSet().length != referenceIds.length) {
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

  final selectorsWithPurchaseActions = <String>{};
  final purchaseActions = <({String buttonId, MosaicPurchaseAction action})>[
    for (final button in nodes.whereType<MosaicButtonComponent>())
      if (button.action case final MosaicPurchaseAction action)
        (buttonId: button.id, action: action),
  ];
  final screenByNodeId = _v03ScreenByNodeId(document);
  for (final entry in purchaseActions) {
    final selectorId = entry.action.productSelectorId;
    if (!selectors.containsKey(selectorId)) {
      throw MosaicProtocolException(
        'Purchase button ${entry.buttonId} references unknown product selector '
        '$selectorId.',
      );
    }
    if (screenByNodeId[entry.buttonId] != screenByNodeId[selectorId]) {
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
  _validateMotionSemantics(document, nodes);
  _validateCapabilities(document, nodes);
}

/// Protocol 0.4 motion rules that the shape of a document cannot express.
///
/// A 0.3 document has no motion vocabulary at all, so every check here is a
/// no-op for it: the decoder has already rejected a `motion` block and an
/// unknown `motions` catalog.
void _validateMotionSemantics(
  MosaicPaywallDocument document,
  List<MosaicNode> nodes,
) {
  final motions = document.designSystem?.motions ?? const [];
  _requireUnique(motions.map((token) => token.id), 'motion token identifier');
  _requireUnique(motions.map((token) => token.name), 'motion token name');

  // Every reference resolves and the graph is acyclic, exactly as the other
  // three catalogs require. Checked over the whole catalog, including tokens
  // the reachability walk below never visits, so an unknown target or a cycle
  // is reported as what it is rather than as a downstream unused token.
  for (final token in motions) {
    document.resolveMotion(token.value);
  }

  final tokensById = <String, MosaicDesignToken<MosaicMotion>>{
    for (final token in motions) token.id: token,
  };
  // Reachability is rooted at *node* reference sites only, and expands through
  // token values transitively.
  //
  // Treating the catalog as its own root would let a token be vouched for by
  // another token that nothing reaches: an orphaned alias pair would keep each
  // other alive, and both would sit in the catalog looking approved. Only a
  // node draws a motion, so only a node can root reachability.
  final reachable = <String>{};
  void reach(MosaicMotion motion) {
    var current = motion;
    while (current is MosaicMotionTokenReference) {
      if (!reachable.add(current.id)) return;
      final token = tokensById[current.id];
      // An unknown target is already rejected by the resolution pass above.
      if (token == null) return;
      current = token.value;
    }
  }

  for (final node in nodes) {
    if (node.motion case final motion?) {
      if (motion.appear case final appear?) {
        document.resolveMotion(appear.curve);
        reach(appear.curve);
      }
      if (motion.selection case final selection?) {
        document.resolveMotion(selection.curve);
        reach(selection.curve);
      }
      if (motion.loop case final loop?) {
        document.resolveMotion(loop.curve);
        reach(loop.curve);
      }
    }
  }

  // Deliberately asymmetric with the colour, background, and shadow catalogs,
  // which carry no unused-token check. Those are inert values. The safety
  // constraint on a motion lives at its *reference* site — the flash-safety
  // floor is checked where a loop names a curve — so a token no node reaches
  // has never been checked against anything and sits in the catalog looking
  // approved. That is a latent accessibility decision, not an inert value.
  for (final token in motions) {
    if (reachable.contains(token.id)) continue;
    throw MosaicProtocolException(
      'Motion token ${token.id} is unused. No node reaches it, so it has '
      'never been checked against the rules that apply at a reference site.',
    );
  }

  final screenByNodeId = _v03ScreenByNodeId(document);
  final loopScreens = <String, String>{};
  for (final node in nodes) {
    final motion = node.motion;
    if (motion == null) continue;
    if (motion.appear != null) {
      final ancestor = _animatedAppearAncestor(document, node.id);
      if (ancestor != null) {
        // Two entrance opacities multiply, and the three renderers compose that
        // product at different points in their pipelines. Rejecting is cheaper
        // than pinning an arithmetic no platform agrees on; an author who wants
        // a group to fade in puts the appear on the group.
        throw MosaicProtocolException(
          '${node.type} ${node.id} declares appear motion inside '
          '${ancestor.type} ${ancestor.id}, which already declares one.',
        );
      }
    }
    if (motion.loop case final loop?) {
      final duration = document.resolveMotion(loop.curve).durationMilliseconds;
      if (duration < mosaicLoopMinimumDurationMilliseconds) {
        throw MosaicProtocolException(
          'Button ${node.id} loop motion resolves to ${duration}ms, below the '
          '${mosaicLoopMinimumDurationMilliseconds}ms flash-safety floor.',
        );
      }
      final screenId = screenByNodeId[node.id] ?? '';
      final existing = loopScreens[screenId];
      if (existing != null) {
        throw MosaicProtocolException(
          'Paywall Screen $screenId declares loop motion on both $existing and '
          '${node.id}; at most one Button per screen may loop.',
        );
      }
      loopScreens[screenId] = node.id;
    }
  }
}

/// The nearest ancestor of [nodeId] that itself declares an entrance, if any.
MosaicNode? _animatedAppearAncestor(
  MosaicPaywallDocument document,
  String nodeId,
) {
  MosaicNode? search(MosaicNode node, MosaicNode? animatedAncestor) {
    if (node.id == nodeId) return animatedAncestor;
    final nextAncestor = node.motion?.appear != null ? node : animatedAncestor;
    for (final child in _motionChildren(node)) {
      final found = search(child, nextAncestor);
      if (found != null || _containsNode(child, nodeId)) return found;
    }
    return null;
  }

  for (final screen in document.screens) {
    if (!_containsNode(screen.layout.content, nodeId)) continue;
    return search(screen.layout.content, null);
  }
  return null;
}

bool _containsNode(MosaicNode node, String nodeId) {
  if (node.id == nodeId) return true;
  for (final child in _motionChildren(node)) {
    if (_containsNode(child, nodeId)) return true;
  }
  return false;
}

/// Every child a motion block can descend through.
///
/// Panels, pages, cards, and badges are all part of the layout tree, so an
/// entrance authored inside one is still nested inside its ancestor's.
Iterable<MosaicNode> _motionChildren(MosaicNode node) sync* {
  switch (node) {
    case MosaicScrollContainer():
      yield node.content;
    case MosaicStackNode():
      yield* node.children;
    case MosaicCarouselComponent():
      for (final page in node.pages) {
        yield page.content;
      }
    case MosaicTabsComponent():
      for (final tab in node.tabs) {
        yield tab.content;
      }
    case MosaicButtonComponent():
      yield* node.children;
      if (node.inProgressChildren case final inProgress?) yield* inProgress;
    case MosaicProductSelectorComponent():
      yield* node.cards;
    case MosaicProductCardComponent():
      yield* node.children;
    case MosaicProductBadgeComponent():
      yield* node.children;
    default:
      break;
  }
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
    for (final child in _productCardChildren(node)) {
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

void _validateV03DesignSystem(MosaicPaywallDocument document) {
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

  for (final color in _allV03Colors(document)) {
    document.resolveColor(color);
  }
  for (final background in _allV03Backgrounds(document)) {
    final resolved = document.resolveBackground(background);
    for (final color in _backgroundColors(resolved)) {
      document.resolveColor(color);
    }
  }
  for (final shadow in _allV03Shadows(document)) {
    final resolved = document.resolveShadow(shadow);
    document.resolveColor(resolved.color);
  }
}

Iterable<MosaicBackground> _allV03Backgrounds(
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
    } else if (node is MosaicTabsComponent) {
      yield node.styles.defaultStyle.background;
      if (node.styles.selectedOverride.background case final background?) {
        yield background;
      }
    }
  }
}

Iterable<MosaicShadow> _allV03Shadows(MosaicPaywallDocument document) sync* {
  yield* document.designSystem!.shadows.map((token) => token.value);
  for (final node in document.nodes) {
    if (_nodeAppearance(node)?.shadow case final shadow?) yield shadow;
    if (node is MosaicProductCardComponent) {
      if (node.styles.defaultStyle.shadow case final shadow?) yield shadow;
      if (node.styles.selectedOverride.shadow case final shadow?) yield shadow;
    } else if (node is MosaicProductBadgeComponent) {
      if (node.styles.defaultStyle.shadow case final shadow?) yield shadow;
      if (node.styles.selectedOverride.shadow case final shadow?) yield shadow;
    } else if (node is MosaicTabsComponent) {
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

Iterable<MosaicColorValue> _allV03Colors(MosaicPaywallDocument document) sync* {
  yield* document.designSystem!.colors.map((token) => token.value);
  for (final background in _allV03Backgrounds(document)) {
    yield* _backgroundColors(document.resolveBackground(background));
  }
  for (final node in document.nodes) {
    final appearance = _nodeAppearance(node);
    if (appearance?.border?.color case final color?) yield color;
    for (final typography in _nodeTypographies(node)) {
      yield typography.color;
    }
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
      case MosaicTabsComponent():
        yield node.selectedLabelColor;
        yield node.styles.defaultStyle.border.color;
        if (node.styles.selectedOverride.borderColor case final color?) {
          yield color;
        }
      case MosaicTimelineComponent():
        yield node.connector.color;
        if (node.markerColor case final color?) yield color;
      case MosaicAwardComponent():
        if (node.emblem case final MosaicAwardIconEmblem emblem) {
          yield emblem.color;
        }
      case MosaicSocialProofComponent():
        if (node.rating case final rating?) {
          yield rating.filledColor;
          yield rating.emptyColor;
        }
      default:
        break;
    }
  }
}

void _validateV03RuntimeSemantics(MosaicPaywallDocument document) {
  final screenByNodeId = _v03ScreenByNodeId(document);
  final switches = <String, MosaicSwitchComponent>{
    for (final node in document.nodes.whereType<MosaicSwitchComponent>())
      node.id: node,
  };
  final tabsById = <String, MosaicTabsComponent>{
    for (final node in document.nodes.whereType<MosaicTabsComponent>())
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
          child is MosaicCarouselComponent ||
          child is MosaicTabsComponent) {
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

  void visit(
    MosaicNode node, {
    required bool insideCarousel,
    required List<MosaicNode> ancestors,
  }) {
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
    if (visibility is MosaicTabVisibility) {
      final controller = tabsById[visibility.tabsId];
      if (controller == null) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility references unknown tabs '
          '${visibility.tabsId}.',
        );
      }
      if (screenByNodeId[controller.id] != screenByNodeId[node.id]) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility must reference a Tabs component '
          'in the same Paywall Screen.',
        );
      }
      // Inside a panel the condition is already decided by the panel:
      // comparing against the owning tab is vacuously true and against any
      // other tab is unsatisfiable. Both are dead layout, and dead layout that
      // renders is indistinguishable from working layout until someone edits
      // it, so both reject.
      if (identical(controller, node) ||
          ancestors.any((ancestor) => identical(ancestor, controller))) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility cannot reference the Tabs '
          'component it belongs to.',
        );
      }
      if (controller.tab(visibility.equals) == null) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility references unknown tab '
          '${visibility.equals} of tabs ${controller.id}.',
        );
      }
    }
    final nested = <MosaicNode>[...ancestors, node];
    void descend(MosaicNode child, {bool carousel = false}) => visit(
          child,
          insideCarousel: insideCarousel || carousel,
          ancestors: nested,
        );
    switch (node) {
      case MosaicStackNode():
        for (final child in node.children) {
          descend(child);
        }
      case MosaicCarouselComponent():
        if (insideCarousel) {
          throw MosaicProtocolException(
            'Carousel ${node.id} cannot be nested inside another Carousel.',
          );
        }
        for (final page in node.pages) {
          descend(page.content, carousel: true);
        }
      case MosaicTabsComponent():
        for (final tab in node.tabs) {
          descend(tab.content);
        }
      case MosaicButtonComponent():
        for (final child in node.children) {
          descend(child);
        }
        if (node.inProgressChildren case final inProgress?) {
          for (final child in inProgress) {
            descend(child);
          }
        }
      case MosaicProductSelectorComponent():
        for (final card in node.cards) {
          descend(card);
        }
      case MosaicProductCardComponent():
        for (final child in node.children) {
          descend(child);
        }
      case MosaicProductBadgeComponent():
        for (final child in node.children) {
          descend(child);
        }
      default:
        break;
    }
  }

  for (final screen in document.screens) {
    visit(
      screen.layout.content,
      insideCarousel: false,
      ancestors: const <MosaicNode>[],
    );
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
        'Protocol 0.3 navigateTo graph must be acyclic.',
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
      'Protocol 0.3 contains unreachable Paywall Screens: '
      '${unreachable.join(', ')}.',
    );
  }
}

Map<String, String> _v03ScreenByNodeId(MosaicPaywallDocument document) {
  return <String, String>{
    for (final screen in document.screens)
      for (final node in document.nodesIn(screen)) node.id: screen.id,
  };
}
