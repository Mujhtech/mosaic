import Foundation

enum MosaicProtocolV02Semantics {
  static func validate(_ document: MosaicPaywallDocument) throws {
    guard document.schemaVersion == mosaicProtocolVersion else {
      throw MosaicProtocolError.unsupportedSchemaVersion(document.schemaVersion)
    }
    guard (1...Int(Int32.max)).contains(document.revision) else {
      throw violation("protocol_invalid_revision")
    }
    try identifier(document.id)

    var declared = Set<MosaicCapabilityName>()
    for capability in document.compatibility.requiredCapabilities {
      guard capability.version == mosaicProtocolVersion else {
        throw MosaicProtocolError.unsupportedCapability(
          name: capability.name.rawValue, version: capability.version)
      }
      guard MosaicCapabilityCatalog.v02.contains(capability.name) else {
        throw MosaicProtocolError.unsupportedCapability(
          name: capability.name.rawValue, version: capability.version)
      }
      guard declared.insert(capability.name).inserted else {
        throw MosaicProtocolError.duplicateCapability(name: capability.name.rawValue)
      }
    }

    guard let designSystem = document.designSystem else {
      throw violation("protocol_missing_design_system")
    }
    try validateDesignSystem(designSystem, document: document)

    var state = State(document: document)
    state.capabilities.formUnion([.scrollContainer, .stack, .screens, .localizationCatalogs])
    if !designSystem.colors.isEmpty || !designSystem.backgrounds.isEmpty
      || !designSystem.shadows.isEmpty
    {
      state.capabilities.insert(.designTokens)
    }

    for asset in document.assets {
      try identifier(asset.id)
      guard state.assetIDs.insert(asset.id).inserted else {
        throw violation("protocol_duplicate_asset_id")
      }
      state.assetTypes[asset.id] = asset.type
      switch asset.source {
      case .bundled(let key):
        try assetKey(key)
        state.capabilities.insert(asset.type == .image ? .bundledImage : .bundledVideo)
      case .remote(let url):
        guard isSafeMosaicV02ExternalURL(url.absoluteString) else {
          throw violation("protocol_invalid_remote_asset_url")
        }
        state.capabilities.insert(asset.type == .image ? .remoteImage : .remoteVideo)
      }
      if let fallback = asset.fallback {
        guard asset.type == .image else { throw violation("protocol_video_asset_has_fallback") }
        state.localizedText(fallback.value)
        state.capabilities.insert(.assetFallback)
      } else if asset.type == .image {
        throw violation("protocol_image_asset_missing_fallback")
      }
    }
    for token in designSystem.backgrounds { try state.background(token.value) }
    for token in designSystem.shadows {
      state.capabilities.insert(.shadow)
      try state.shadow(token.value)
    }

    for product in document.products {
      try identifier(product.id)
      try providerProductID(product.productId)
      guard state.productReferenceIDs.insert(product.id).inserted else {
        throw violation("protocol_duplicate_product_reference_id")
      }
      guard state.providerProductIDs.insert(product.productId).inserted else {
        throw violation("protocol_duplicate_provider_product_id")
      }
      state.localizedText(product.label)
      state.localizedText(product.badge)
    }
    if !document.products.isEmpty { state.capabilities.insert(.productReferences) }

    guard (1...10).contains(document.screens.count) else {
      throw violation("protocol_invalid_screen_count")
    }
    for screen in document.screens {
      try identifier(screen.id)
      guard state.screenIDs.insert(screen.id).inserted else {
        throw violation("protocol_duplicate_screen_id")
      }
    }
    guard let initialScreenID = document.initialScreenId,
      state.screenIDs.contains(initialScreenID)
    else { throw violation("protocol_unknown_initial_screen") }
    guard document.screen(id: initialScreenID)?.presentation?.type == .screen else {
      throw violation("protocol_initial_screen_must_be_screen")
    }

    for screen in document.screens {
      state.currentScreenID = screen.id
      if let label = screen.accessibilityLabel {
        state.localizedText(label)
      } else if document.screens.count > 1 {
        throw violation("protocol_missing_screen_accessibility_label")
      }
      guard let presentation = screen.presentation else {
        throw violation("protocol_missing_screen_presentation")
      }
      if presentation.type == .sheet { state.capabilities.insert(.sheets) }
      try state.layoutID(screen.layout.id)
      guard screen.layout.type == .scrollContainer else {
        throw violation("protocol_invalid_root_layout")
      }
      if let background = screen.layout.background {
        state.capabilities.formUnion([.boxStyle, .colors])
        try state.background(background)
      }
      guard screen.layout.content.direction == .vertical else {
        throw violation("protocol_root_stack_must_be_vertical")
      }
      guard !screen.layout.content.children.isEmpty else {
        throw violation("protocol_empty_root_stack")
      }
      try state.stack(screen.layout.content, carouselDepth: 0)
    }
    state.currentScreenID = nil

    guard state.usedAssetIDs == state.assetIDs else {
      throw violation("protocol_asset_reference_mismatch")
    }
    guard state.usedProductReferenceIDs == state.productReferenceIDs else {
      throw violation("protocol_product_reference_mismatch")
    }
    guard state.selectorIDs == state.purchaseSelectorIDs else {
      throw violation("protocol_purchase_action_mismatch")
    }

    for reference in state.visibilityReferences {
      guard state.switchScreenByID[reference.switchID] == reference.screenID else {
        throw violation("protocol_unknown_visibility_switch")
      }
      guard reference.nodeID != reference.switchID else {
        throw violation("protocol_self_visibility_switch")
      }
    }
    for reference in state.purchaseReferences {
      guard state.selectorScreenByID[reference.selectorID] == reference.screenID else {
        throw violation("protocol_purchase_selector_must_share_screen")
      }
    }
    for target in state.navigationEdges.values.flatMap(\.self) {
      guard state.screenIDs.contains(target) else {
        throw violation("protocol_unknown_navigation_screen")
      }
    }
    try validateNavigationGraph(
      initialScreenID: initialScreenID,
      screenIDs: state.screenIDs,
      edges: state.navigationEdges
    )

    try validateLocalization(
      document.localization,
      texts: state.localizedTextEntries.map(\.text)
    )
    let usesProductTemplate = try validateProductTemplates(
      document.localization,
      entries: state.localizedTextEntries
    )
    if usesProductTemplate { state.capabilities.insert(.productTemplate) }
    if document.localization.locales.values.contains(where: { $0.direction == .rightToLeft }) {
      state.capabilities.insert(.localizationRTL)
    }

    if let missing = state.capabilities.subtracting(declared).first {
      throw violation("protocol_missing_capability_\(missing.rawValue)")
    }
    let unused = declared.subtracting(state.capabilities)
    guard unused.isSubset(of: [.staticVisibility]) else {
      throw violation("protocol_unused_capability")
    }
  }

  struct VisibilityReference {
    let nodeID: String
    let switchID: String
    let screenID: String
  }

  struct PurchaseReference {
    let selectorID: String
    let screenID: String
  }

  struct LocalizedTextEntry {
    let text: MosaicLocalizedText
    let productTemplateAllowed: Bool
  }

  private struct State {
    var capabilities = Set<MosaicCapabilityName>()
    var screenIDs = Set<String>()
    var layoutIDs = Set<String>()
    var assetIDs = Set<String>()
    var assetTypes: [String: MosaicAssetType] = [:]
    var usedAssetIDs = Set<String>()
    var productReferenceIDs = Set<String>()
    var providerProductIDs = Set<String>()
    var usedProductReferenceIDs = Set<String>()
    var selectorIDs = Set<String>()
    var purchaseSelectorIDs = Set<String>()
    var selectorScreenByID: [String: String] = [:]
    var switchScreenByID: [String: String] = [:]
    var visibilityReferences: [VisibilityReference] = []
    var purchaseReferences: [PurchaseReference] = []
    var navigationEdges: [String: Set<String>] = [:]
    var localizedTextEntries: [LocalizedTextEntry] = []
    var currentScreenID: String?
    let document: MosaicPaywallDocument

    mutating func layoutID(_ id: String) throws {
      try identifier(id)
      guard layoutIDs.insert(id).inserted else { throw violation("protocol_duplicate_layout_id") }
    }

    mutating func stack(
      _ stack: MosaicStack,
      carouselDepth: Int,
      productCardContext: Bool = false
    ) throws {
      guard stack.type == .stack else { throw violation("protocol_invalid_stack_type") }
      try layoutID(stack.id)
      try logicalSize(stack.gap)
      try insets(stack.padding)
      capabilities.formUnion([.stack, .boxStyle])
      try presentation(
        id: stack.id,
        appearance: stack.appearance,
        sizing: stack.sizing,
        outerInsets: stack.outerInsets,
        visibility: stack.visibility
      )
      for node in stack.children {
        try validate(
          node,
          carouselDepth: carouselDepth,
          productCardContext: productCardContext
        )
      }
    }

    mutating func validate(
      _ node: MosaicNode,
      carouselDepth: Int,
      productCardContext: Bool = false
    ) throws {
      if productCardContext, !isPassiveProductCardNode(node) {
        throw violation("protocol_interactive_product_card_descendant")
      }
      switch node {
      case .verticalStack:
        throw violation("protocol_0_1_node_in_0_2_document")
      case .stack(let component):
        try stack(
          component,
          carouselDepth: carouselDepth,
          productCardContext: productCardContext
        )
      case .text(let component):
        try layoutID(component.id)
        capabilities.formUnion([.text, .typography, .colors, .accessibilityMetadata])
        localizedText(component.value, productTemplateAllowed: productCardContext)
        try textAccessibility(component.accessibility)
        localizedText(component.accessibility.label)
        try typography(component.typography, allowsTruncation: true)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .image(let component):
        try layoutID(component.id)
        capabilities.formUnion([.image, .accessibilityMetadata])
        try identifier(component.assetId)
        if let aspectRatio = component.aspectRatio {
          try finite(
            aspectRatio, minimum: .leastNonzeroMagnitude, maximum: 10,
            code: "protocol_invalid_image_aspect_ratio")
        }
        usedAssetIDs.insert(component.assetId)
        guard assetTypes[component.assetId] == .image else {
          throw violation("protocol_image_component_requires_image_asset")
        }
        if case .informative(let label) = component.accessibility { localizedText(label) }
        try presentation(
          id: component.id, appearance: component.appearance, sizing: component.sizing,
          outerInsets: component.outerInsets, visibility: component.visibility)
      case .icon(let component):
        try layoutID(component.id)
        capabilities.formUnion([.icon, .colors, .accessibilityMetadata])
        try positiveSize(component.size)
        try color(component.color)
        if case .informative(let label) = component.accessibility { localizedText(label) }
        try presentation(
          id: component.id, appearance: component.appearance, sizing: component.sizing,
          outerInsets: component.outerInsets, visibility: component.visibility)
      case .featureList(let component):
        try layoutID(component.id)
        capabilities.formUnion([.featureList, .typography, .colors, .accessibilityMetadata])
        try logicalSize(component.gap)
        try color(component.markerColor)
        try typography(component.typography, allowsTruncation: false)
        guard !component.items.isEmpty else { throw violation("protocol_empty_feature_list") }
        var itemIDs = Set<String>()
        for item in component.items {
          try identifier(item.id)
          guard itemIDs.insert(item.id).inserted else {
            throw violation("protocol_duplicate_feature_id")
          }
          localizedText(item.text)
        }
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .productSelector(let component):
        try layoutID(component.id)
        capabilities.formUnion([
          .productSelector, .productFallback, .normalizedOutcome, .productCardStates,
          .colors, .boxStyle, .accessibilityMetadata,
        ])
        try logicalSize(component.gap)
        guard !component.cards.isEmpty else {
          throw violation("protocol_empty_product_selector")
        }
        var references = Set<String>()
        var cardIDs = Set<String>()
        for card in component.cards {
          let referenceID = card.productReferenceId
          try identifier(referenceID)
          guard references.insert(referenceID).inserted else {
            throw violation("protocol_duplicate_selector_product")
          }
          guard productReferenceIDs.contains(referenceID) else {
            throw violation("protocol_unknown_selector_product")
          }
          usedProductReferenceIDs.insert(referenceID)
          guard cardIDs.insert(card.id).inserted else {
            throw violation("protocol_duplicate_product_card_id")
          }
          try productCard(card)
        }
        guard let initialProductCardID = component.initialProductCardId,
          cardIDs.contains(initialProductCardID)
        else {
          throw violation("protocol_invalid_initial_selection")
        }
        selectorIDs.insert(component.id)
        selectorScreenByID[component.id] = try screenID()
        localizedText(component.unavailableFallback.message)
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .button(let component):
        try layoutID(component.id)
        capabilities.formUnion([.button, .accessibilityMetadata])
        try logicalSize(component.gap)
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        guard !component.children.isEmpty else { throw violation("protocol_empty_button_content") }
        guard !component.children.contains(where: containsInteractiveNode) else {
          throw violation("protocol_interactive_button_descendant")
        }
        for child in component.children { try validate(child, carouselDepth: carouselDepth) }
        if let inProgressChildren = component.inProgressChildren {
          guard !inProgressChildren.isEmpty else {
            throw violation("protocol_empty_button_progress_content")
          }
          guard !inProgressChildren.contains(where: containsInteractiveNode) else {
            throw violation("protocol_interactive_button_descendant")
          }
          for child in inProgressChildren { try validate(child, carouselDepth: carouselDepth) }
        }
        let currentScreenID = try screenID()
        switch component.action {
        case .purchase(let selectorID):
          capabilities.formUnion([.purchaseAction, .normalizedOutcome])
          try identifier(selectorID)
          purchaseSelectorIDs.insert(selectorID)
          purchaseReferences.append(
            PurchaseReference(selectorID: selectorID, screenID: currentScreenID))
        case .restore:
          capabilities.formUnion([.restoreAction, .normalizedOutcome])
        case .close:
          capabilities.formUnion([.closeAction, .normalizedOutcome])
        case .navigateTo(let targetScreenID):
          capabilities.insert(.navigateToAction)
          try identifier(targetScreenID)
          navigationEdges[currentScreenID, default: []].insert(targetScreenID)
        case .navigateBack:
          capabilities.insert(.navigateBackAction)
        case .openExternalURL(let url):
          capabilities.insert(.openExternalURLAction)
          try externalURL(url)
        }
        if component.inProgressChildren != nil,
          component.action.type != .purchase && component.action.type != .restore
        {
          throw violation("protocol_progress_content_requires_async_action")
        }
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .purchaseButton, .restoreButton, .closeButton, .legalText:
        throw violation("protocol_0_1_node_in_0_2_document")
      case .carousel(let component):
        try layoutID(component.id)
        capabilities.formUnion([.carousel, .accessibilityMetadata])
        guard carouselDepth == 0 else { throw violation("protocol_nested_carousel") }
        guard (2...20).contains(component.pages.count),
          component.pages.indices.contains(component.initialPageIndex)
        else { throw violation("protocol_invalid_carousel_pages") }
        var pageIDs = Set<String>()
        for page in component.pages {
          try identifier(page.id)
          guard layoutIDs.insert(page.id).inserted, pageIDs.insert(page.id).inserted else {
            throw violation("protocol_duplicate_layout_id")
          }
          localizedText(page.accessibilityLabel)
          try stack(page.content, carouselDepth: carouselDepth + 1)
        }
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      case .switchControl(let component):
        try layoutID(component.id)
        switchScreenByID[component.id] = try screenID()
        capabilities.formUnion([.switchControl, .typography, .colors, .accessibilityMetadata])
        localizedText(component.label)
        localizedText(component.accessibility.label)
        localizedText(component.accessibility.hint)
        try typography(component.typography, allowsTruncation: false)
        try color(component.offTrackColor)
        try color(component.onTrackColor)
        try color(component.thumbColor)
        try presentation(
          id: component.id, appearance: component.appearance, sizing: component.sizing,
          outerInsets: component.outerInsets, visibility: component.visibility)
      case .countdown(let component):
        try layoutID(component.id)
        capabilities.formUnion([.countdown, .typography, .colors, .accessibilityMetadata])
        guard component.largestUnit.rank >= component.smallestUnit.rank else {
          throw violation("protocol_invalid_countdown_unit_order")
        }
        guard canonicalDate(component.endsAt) != nil else {
          throw violation("protocol_invalid_countdown_timestamp")
        }
        localizedText(component.completedText)
        try textAccessibility(component.accessibility)
        localizedText(component.accessibility.label)
        try typography(component.typography, allowsTruncation: false)
        try presentation(
          id: component.id, appearance: component.appearance,
          sizing: component.sizing, outerInsets: component.outerInsets,
          visibility: component.visibility)
      }
    }

    mutating func presentation(
      id: String,
      appearance: MosaicBoxAppearance?,
      sizing: MosaicBoxSizing?,
      outerInsets: MosaicEdgeInsets?,
      visibility: MosaicVisibility
    ) throws {
      if let appearance {
        capabilities.insert(.boxStyle)
        if appearance.background != nil || appearance.border != nil { capabilities.insert(.colors) }
        if let background = appearance.background { try self.background(background) }
        if let border = appearance.border { try borderValue(border) }
        if let radius = appearance.cornerRadius { try logicalSize(radius) }
        if let opacity = appearance.opacity {
          try finite(opacity, minimum: 0, maximum: 1, code: "protocol_invalid_opacity")
        }
        if let padding = appearance.padding { try insets(padding) }
        if appearance.clipContent != nil { capabilities.insert(.clipping) }
        if let shadow = appearance.shadow {
          capabilities.insert(.shadow)
          try self.shadow(shadow)
        }
      }
      if let sizing {
        try validateSizing(sizing)
      }
      if let outerInsets {
        capabilities.insert(.outerInsets)
        try insets(outerInsets)
      }
      switch visibility {
      case .always: break
      case .hidden: capabilities.insert(.staticVisibility)
      case .switchValue(let switchID, _):
        capabilities.insert(.switchVisibility)
        visibilityReferences.append(
          VisibilityReference(nodeID: id, switchID: switchID, screenID: try screenID()))
      }
    }

    mutating func validateSizing(_ sizing: MosaicBoxSizing) throws {
      capabilities.formUnion([.sizing, .heightSizing])
      guard let widthValue = sizing.width, let height = sizing.height else {
        throw violation("protocol_incomplete_box_sizing")
      }
      if case .content = widthValue {
        throw violation("protocol_candidate_content_sizing_not_supported")
      }
      try width(widthValue)
      switch height {
      case .content: throw violation("protocol_candidate_content_sizing_not_supported")
      case .fit, .fill: break
      case .fixed(let value): try positiveSize(value)
      }
    }

    private func screenID() throws -> String {
      guard let currentScreenID else { throw violation("protocol_missing_validation_screen") }
      return currentScreenID
    }

    private func containsInteractiveNode(_ node: MosaicNode) -> Bool {
      switch node {
      case .button, .productSelector, .switchControl, .carousel:
        true
      case .stack(let stack), .verticalStack(let stack):
        stack.children.contains(where: containsInteractiveNode)
      default:
        false
      }
    }

    private func isPassiveProductCardNode(_ node: MosaicNode) -> Bool {
      switch node {
      case .stack, .text, .image, .icon, .featureList, .countdown:
        true
      case .verticalStack, .productSelector, .button, .purchaseButton, .restoreButton,
        .closeButton, .legalText, .carousel, .switchControl:
        false
      }
    }

    mutating func productCard(_ card: MosaicProductCardComponent) throws {
      try layoutID(card.id)
      capabilities.formUnion([
        .productCard, .productCardStates, .boxStyle, .colors,
      ])
      try logicalSize(card.gap)
      guard !card.children.isEmpty else { throw violation("protocol_empty_product_card") }
      guard card.clipContent == nil || card.clipContent == false else {
        throw violation("protocol_invalid_product_card_clipping")
      }
      let badges = card.children.compactMap { child -> MosaicProductBadgeComponent? in
        guard case .badge(let badge) = child else { return nil }
        return badge
      }
      guard badges.count <= 1 else { throw violation("protocol_multiple_product_badges") }

      let productCardMetrics = card.children.reduce(into: ProductCardMetrics()) { result, child in
        result.merge(metrics(for: child, stackDepth: 0))
      }
      guard productCardMetrics.descendantCount <= 20 else {
        throw violation("protocol_product_card_descendant_limit")
      }
      guard productCardMetrics.maximumStackDepth <= 4 else {
        throw violation("protocol_product_card_stack_depth")
      }

      try authoredProductStyles(card.styles)
      if let sizing = card.sizing { try validateSizing(sizing) }
      if let accessibility = card.accessibility {
        localizedText(accessibility.label, productTemplateAllowed: true)
      }
      for child in card.children {
        switch child {
        case .node(let node):
          try validate(node, carouselDepth: 0, productCardContext: true)
        case .badge(let badge):
          try productBadge(badge)
        }
      }
    }

    mutating func productBadge(_ badge: MosaicProductBadgeComponent) throws {
      try layoutID(badge.id)
      capabilities.formUnion([
        .productBadge, .productCardStates, .boxStyle, .colors,
      ])
      try logicalSize(badge.gap)
      guard (1...10).contains(badge.children.count) else {
        throw violation("protocol_invalid_product_badge_children")
      }
      if case .overlay(_, let inset) = badge.placement {
        try finite(
          inset,
          minimum: 0,
          maximum: 64,
          code: "protocol_invalid_product_badge_inset"
        )
      }
      try authoredProductStyles(badge.styles)
      if let sizing = badge.sizing { try validateSizing(sizing) }
      for child in badge.children {
        try validate(child, carouselDepth: 0, productCardContext: true)
      }
    }

    func color(_ value: MosaicColor) throws {
      try MosaicProtocolV02Semantics.color(value)
      guard document.resolvedColor(value) != nil else {
        throw violation("protocol_unknown_or_cyclic_color_token")
      }
    }

    func borderValue(_ value: MosaicBorder) throws {
      try color(value.color)
      try logicalSize(value.width)
    }

    func typography(_ value: MosaicTypography, allowsTruncation: Bool) throws {
      try MosaicProtocolV02Semantics.typography(value, allowsTruncation: allowsTruncation)
      try color(value.color)
    }

    mutating func background(_ value: MosaicBackground) throws {
      guard let resolved = document.resolvedBackground(value) else {
        throw violation("protocol_unknown_or_cyclic_background_token")
      }
      if case .token = value { capabilities.insert(.designTokens) }
      switch resolved {
      case .color(let color): try self.color(color)
      case .linearGradient(let angle, let stops):
        capabilities.insert(.gradientBackground)
        try finite(angle, minimum: 0, maximum: 360, code: "protocol_invalid_gradient_angle")
        guard (2...8).contains(stops.count) else {
          throw violation("protocol_invalid_gradient_stops")
        }
        for stop in stops { try self.color(stop.color) }
        var prior = -Double.infinity
        for stop in stops {
          guard stop.position >= 0, stop.position <= 1, stop.position > prior else {
            throw violation("protocol_invalid_gradient_stops")
          }
          prior = stop.position
        }
      case .radialGradient(let center, let radius, let stops):
        capabilities.insert(.gradientBackground)
        try finite(center.x, minimum: 0, maximum: 1, code: "protocol_invalid_gradient_center")
        try finite(center.y, minimum: 0, maximum: 1, code: "protocol_invalid_gradient_center")
        try finite(
          radius, minimum: .leastNonzeroMagnitude, maximum: 2,
          code: "protocol_invalid_gradient_radius")
        guard (2...8).contains(stops.count) else {
          throw violation("protocol_invalid_gradient_stops")
        }
        for stop in stops { try self.color(stop.color) }
        var prior = -Double.infinity
        for stop in stops {
          guard stop.position >= 0, stop.position <= 1, stop.position > prior else {
            throw violation("protocol_invalid_gradient_stops")
          }
          prior = stop.position
        }
      case .image(let assetID, _, let fallback):
        capabilities.insert(.mediaBackground)
        guard assetTypes[assetID] == .image else {
          throw violation("protocol_image_background_requires_image_asset")
        }
        usedAssetIDs.insert(assetID)
        try self.color(fallback)
      case .video(let assetID, let posterID, _, let fallback):
        capabilities.insert(.mediaBackground)
        guard assetTypes[assetID] == .video else {
          throw violation("protocol_video_background_requires_video_asset")
        }
        usedAssetIDs.insert(assetID)
        if let posterID {
          guard assetTypes[posterID] == .image else {
            throw violation("protocol_video_poster_requires_image_asset")
          }
          usedAssetIDs.insert(posterID)
        }
        try self.color(fallback)
      // Token resolution already ran, so this is unreachable. Rejecting the
      // document is still safer than trapping inside a host application.
      case .token: throw violation("protocol_unknown_or_cyclic_background_token")
      }
    }

    func shadow(_ value: MosaicShadow) throws {
      guard let resolved = document.resolvedShadow(value) else {
        throw violation("protocol_unknown_or_cyclic_shadow_token")
      }
      guard case .value(let color, let x, let y, let blur) = resolved else {
        throw violation("protocol_invalid_shadow")
      }
      try self.color(color)
      try finite(x, minimum: -4096, maximum: 4096, code: "protocol_invalid_shadow_offset")
      try finite(y, minimum: -4096, maximum: 4096, code: "protocol_invalid_shadow_offset")
      try logicalSize(blur)
    }

    mutating func authoredProductStyles(_ styles: MosaicAuthoredProductStyles) throws {
      let base = styles.defaultStyle
      try background(base.background)
      try borderValue(base.border)
      try logicalSize(base.cornerRadius)
      try insets(base.padding)
      try finite(base.opacity, minimum: 0, maximum: 1, code: "protocol_invalid_opacity")
      if let shadow = base.shadow {
        capabilities.insert(.shadow)
        try self.shadow(shadow)
      }
      let selected = styles.selected.resolving(base)
      try background(selected.background)
      try borderValue(selected.border)
      try logicalSize(selected.cornerRadius)
      try insets(selected.padding)
      try finite(selected.opacity, minimum: 0, maximum: 1, code: "protocol_invalid_opacity")
      if let shadow = selected.shadow {
        capabilities.insert(.shadow)
        try self.shadow(shadow)
      }
    }

    private struct ProductCardMetrics {
      var descendantCount = 0
      var maximumStackDepth = 0

      mutating func merge(_ other: ProductCardMetrics) {
        descendantCount += other.descendantCount
        maximumStackDepth = max(maximumStackDepth, other.maximumStackDepth)
      }
    }

    private func metrics(
      for child: MosaicProductCardChild,
      stackDepth: Int
    ) -> ProductCardMetrics {
      switch child {
      case .node(let node): metrics(for: node, stackDepth: stackDepth)
      case .badge(let badge):
        badge.children.reduce(
          into: ProductCardMetrics(descendantCount: 1, maximumStackDepth: stackDepth)
        ) { result, child in
          result.merge(metrics(for: child, stackDepth: stackDepth))
        }
      }
    }

    private func metrics(for node: MosaicNode, stackDepth: Int) -> ProductCardMetrics {
      switch node {
      case .stack(let stack):
        let nextDepth = stackDepth + 1
        return stack.children.reduce(
          into: ProductCardMetrics(descendantCount: 1, maximumStackDepth: nextDepth)
        ) { result, child in
          result.merge(metrics(for: child, stackDepth: nextDepth))
        }
      default:
        return ProductCardMetrics(
          descendantCount: 1,
          maximumStackDepth: stackDepth
        )
      }
    }

    mutating func localizedText(
      _ text: MosaicLocalizedText?,
      productTemplateAllowed: Bool = false
    ) {
      if let text {
        localizedTextEntries.append(
          LocalizedTextEntry(text: text, productTemplateAllowed: productTemplateAllowed)
        )
      }
    }
  }

}
