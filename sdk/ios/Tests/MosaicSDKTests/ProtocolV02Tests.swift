import Foundation
import XCTest

@testable import MosaicSDK

@MainActor
final class ProtocolV02Tests: XCTestCase {
  func testCanonicalV02DecodesEveryNewNativeComponentAndStyleState() throws {
    let document = try v02Document()

    XCTAssertEqual(document.schemaVersion, "0.2")
    XCTAssertEqual(document.initialScreenId, "offer")
    XCTAssertEqual(document.screens.map(\.id), ["offer", "details"])
    XCTAssertEqual(document.screens.map { $0.presentation?.type }, [.screen, .sheet])
    XCTAssertEqual(document.layout.content.type, .stack)
    XCTAssertEqual(document.layout.content.direction, .vertical)
    XCTAssertFalse(document.switches.isEmpty)
    XCTAssertEqual(document.carousels.single?.pages.count, 2)

    let kinds = Set(document.allNodes.map(\.kind))
    XCTAssertTrue(
      kinds.isSuperset(of: [.stack, .icon, .button, .carousel, .switchControl, .countdown])
    )
    XCTAssertTrue(
      kinds.isDisjoint(with: [.purchaseButton, .restoreButton, .closeButton, .legalText]))

    let actions = Set(
      document.allNodes.compactMap { node -> String? in
        guard case .button(let button) = node else { return nil }
        return button.action.type.rawValue
      }
    )
    XCTAssertEqual(
      actions,
      ["purchase", "restore", "close", "navigateTo", "navigateBack", "openExternalUrl"]
    )

    let selector = try XCTUnwrap(document.productSelectors.single)
    XCTAssertEqual(selector.direction, .horizontal)
    XCTAssertEqual(selector.crossAxisAlignment, .stretch)
    XCTAssertEqual(selector.initialProductCardId, "plans-yearly-plan-card")
    XCTAssertEqual(
      selector.cards.map(\.id),
      ["plans-monthly-plan-card", "plans-yearly-plan-card", "plans-lifetime-plan-card"]
    )
    XCTAssertEqual(
      selector.cards.map(\.productReferenceId),
      ["monthly-plan", "yearly-plan", "lifetime-plan"]
    )

    let monthly = selector.cards[0]
    let yearly = selector.cards[1]
    let lifetime = selector.cards[2]
    XCTAssertEqual(monthly.direction, .horizontal)
    XCTAssertEqual(yearly.direction, .vertical)
    XCTAssertEqual(lifetime.crossAxisAlignment, .center)

    let resolved = yearly.styles.resolving(selected: true)
    XCTAssertEqual(resolved.cornerRadius, yearly.styles.defaultStyle.cornerRadius)
    XCTAssertEqual(resolved.padding.top, yearly.styles.defaultStyle.padding.top)
    XCTAssertEqual(resolved.padding.start, 18)
    XCTAssertEqual(resolved.border.width, 2)
    XCTAssertEqual(resolved.background.rawValue, "surface.elevated")

    let yearlyBadge = try XCTUnwrap(
      yearly.children.compactMap { child -> MosaicProductBadgeComponent? in
        guard case .badge(let badge) = child else { return nil }
        return badge
      }.single
    )
    XCTAssertEqual(yearlyBadge.placement, .nested)
    XCTAssertEqual(
      yearlyBadge.styles.resolving(selected: true).background.rawValue,
      "action.primary"
    )
    let lifetimeBadge = try XCTUnwrap(
      lifetime.children.compactMap { child -> MosaicProductBadgeComponent? in
        guard case .badge(let badge) = child else { return nil }
        return badge
      }.single
    )
    XCTAssertEqual(lifetimeBadge.placement, .overlay(anchor: .topEnd, inset: 8))

    let designSystem = try XCTUnwrap(document.designSystem)
    XCTAssertEqual(designSystem.colors.map(\.id), ["brand-primary", "brand-accent"])
    XCTAssertEqual(
      document.resolvedColor(.token("brand-accent")),
      .literal("#007F73FF")
    )
    guard
      case .linearGradient(let angle, let stops) = document.resolvedBackground(
        .token("offer-gradient"))
    else { return XCTFail("Expected the chained background token to resolve to a gradient.") }
    XCTAssertEqual(angle, 135)
    XCTAssertEqual(stops.map(\.position), [0, 1])
    guard case .value(_, let x, let y, let blur) = document.resolvedShadow(.token("elevated"))
    else { return XCTFail("Expected the chained shadow token to resolve.") }
    XCTAssertEqual(x, 0)
    XCTAssertEqual(y, 8)
    XCTAssertEqual(blur, 24)

    XCTAssertEqual(document.assets.map(\.type), [.image, .image, .video, .video])
    guard case .remote(let remoteTextureURL) = document.assets[1].source,
      case .bundled(let bundledVideoKey) = document.assets[2].source
    else { return XCTFail("Expected canonical remote-image and bundled-video sources.") }
    XCTAssertEqual(remoteTextureURL.scheme, "https")
    XCTAssertEqual(bundledVideoKey, "mosaic.offer.ambient-video")

    guard case .image(let hero) = document.allNodes.first(where: { $0.id == "hero" }) else {
      return XCTFail("Expected canonical hero image.")
    }
    XCTAssertEqual(hero.sizing?.width, .fill)
    XCTAssertEqual(hero.sizing?.height, .fixed(180))

    XCTAssertEqual(
      MosaicSDKCapabilityReport.current.supportedSchemaVersions,
      ["0.1", "0.2"]
    )
    XCTAssertEqual(
      Set(
        MosaicSDKCapabilityReport.current.capabilities
          .filter { $0.version == "0.2" }
          .map(\.name)
      ),
      Set(MosaicCapabilityCatalog.v02)
    )
  }

  func testV02EdgeAndExpiredFixturesDecodeWhileNoncanonicalColorFailsClosed() throws {
    XCTAssertNoThrow(try v02Document(named: "edge-cases.json"))
    XCTAssertNoThrow(try v02Document(named: "expired-countdown.json"))
    XCTAssertNoThrow(try v02Document(named: "navigation-only.json"))
    XCTAssertThrowsError(
      try MosaicProtocolDecoder.decode(v02FixtureData(named: "invalid/noncanonical-color.json"))
    ) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .invalidShape(
          path: "$.screens[0].layout.content.children[0].appearance.background",
          reason: "expected_object"
        )
      )
    }
  }

  func testRC4DesignTokensRejectMissingCrossCategoryAndCyclicReferencesAtomically() throws {
    var missing = try v02FixtureObject()
    var designSystem = try XCTUnwrap(missing["designSystem"] as? [String: Any])
    var backgrounds = try XCTUnwrap(designSystem["backgrounds"] as? [[String: Any]])
    backgrounds[0]["value"] = ["type": "backgroundToken", "id": "brand-primary"]
    designSystem["backgrounds"] = backgrounds
    missing["designSystem"] = designSystem
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(missing))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_unknown_or_cyclic_background_token")
      )
    }

    var cyclic = try v02FixtureObject()
    designSystem = try XCTUnwrap(cyclic["designSystem"] as? [String: Any])
    backgrounds = try XCTUnwrap(designSystem["backgrounds"] as? [[String: Any]])
    backgrounds[0]["value"] = ["type": "backgroundToken", "id": "highlight-glow"]
    backgrounds[1]["value"] = ["type": "backgroundToken", "id": "offer-gradient"]
    designSystem["backgrounds"] = backgrounds
    cyclic["designSystem"] = designSystem
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(cyclic))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_unknown_or_cyclic_background_token")
      )
    }

    var missingCatalog = try v02FixtureObject()
    missingCatalog.removeValue(forKey: "designSystem")
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(missingCatalog))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .invalidShape(path: "$", reason: "missing_property")
      )
    }
  }

  func testRC4RejectsInvalidGradientSizingMediaAndPresentationSemantics() throws {
    var gradient = try v02FixtureObject()
    var designSystem = try XCTUnwrap(gradient["designSystem"] as? [String: Any])
    var backgrounds = try XCTUnwrap(designSystem["backgrounds"] as? [[String: Any]])
    var linear = try XCTUnwrap(backgrounds[0]["value"] as? [String: Any])
    linear["angle"] = 361
    backgrounds[0]["value"] = linear
    designSystem["backgrounds"] = backgrounds
    gradient["designSystem"] = designSystem
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(gradient))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_invalid_gradient_angle")
      )
    }

    var sizing = try v02FixtureObject()
    try mutateV02Node(id: "hero", in: &sizing) { node in
      node["sizing"] = ["width": "fill"]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(sizing))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .invalidShape(
          path: "$.screens[0].layout.content.children[1].sizing",
          reason: "missing_property"
        )
      )
    }

    var media = try v02FixtureObject()
    designSystem = try XCTUnwrap(media["designSystem"] as? [String: Any])
    backgrounds = try XCTUnwrap(designSystem["backgrounds"] as? [[String: Any]])
    var video = try XCTUnwrap(backgrounds[4]["value"] as? [String: Any])
    video["assetId"] = "remote-texture"
    backgrounds[4]["value"] = video
    designSystem["backgrounds"] = backgrounds
    media["designSystem"] = designSystem
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(media))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_video_background_requires_video_asset")
      )
    }

    var presentation = try v02FixtureObject()
    var screens = try XCTUnwrap(presentation["screens"] as? [[String: Any]])
    screens[0]["presentation"] = ["type": "sheet"]
    presentation["screens"] = screens
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(presentation))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_initial_screen_must_be_screen")
      )
    }
  }

  func testRC4LinearGradientUsesFrozenPhysicalClockwiseGeometry() {
    let zero = MosaicGradientGeometry.endpoints(angle: 0)
    XCTAssertEqual(zero.start.x, 0, accuracy: 0.000_001)
    XCTAssertEqual(zero.start.y, 0.5, accuracy: 0.000_001)
    XCTAssertEqual(zero.end.x, 1, accuracy: 0.000_001)
    XCTAssertEqual(zero.end.y, 0.5, accuracy: 0.000_001)

    let ninety = MosaicGradientGeometry.endpoints(angle: 90)
    XCTAssertEqual(ninety.start.x, 0.5, accuracy: 0.000_001)
    XCTAssertEqual(ninety.start.y, 0, accuracy: 0.000_001)
    XCTAssertEqual(ninety.end.x, 0.5, accuracy: 0.000_001)
    XCTAssertEqual(ninety.end.y, 1, accuracy: 0.000_001)

    let fullTurn = MosaicGradientGeometry.endpoints(angle: 360)
    XCTAssertEqual(fullTurn.start.x, zero.start.x, accuracy: 0.000_001)
    XCTAssertEqual(fullTurn.start.y, zero.start.y, accuracy: 0.000_001)
    XCTAssertEqual(fullTurn.end.x, zero.end.x, accuracy: 0.000_001)
    XCTAssertEqual(fullTurn.end.y, zero.end.y, accuracy: 0.000_001)
  }

  func testSwitchVisibilityCarouselStateAndControlledCountdownResetPerModel() throws {
    let document = try v02Document()
    let first = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      clock: { Date(timeIntervalSince1970: 1_893_455_998) },
      onResult: { _ in }
    )
    let offerSwitch = try XCTUnwrap(document.switches.first { $0.id == "show-offer-details" })
    let carousel = try XCTUnwrap(document.carousels.single)

    XCTAssertTrue(first.switchValue(for: offerSwitch.id))
    XCTAssertEqual(first.carouselPageIndex(for: carousel.id), 1)
    XCTAssertTrue(first.isNodeVisible("offer-highlights"))
    XCTAssertFalse(first.isNodeVisible("offer-countdown"))

    first.setSwitchValue(false, for: offerSwitch.id)
    first.setCarouselPageIndex(0, for: carousel.id)
    XCTAssertFalse(first.isNodeVisible("offer-highlights"))
    XCTAssertTrue(first.isNodeVisible("offer-countdown"))

    let acceptedRevisionModel = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(),
      onResult: { _ in }
    )
    XCTAssertTrue(acceptedRevisionModel.switchValue(for: offerSwitch.id))
    XCTAssertEqual(acceptedRevisionModel.carouselPageIndex(for: carousel.id), 1)
  }

  func testV02AccessibilityProjectionTracksNativeRuntimeVisibilityAndSelection() async throws {
    let document = try v02Document()
    let model = MosaicPaywallModel(
      document: document,
      requestedLocale: "ar-EG",
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      clock: { Date(timeIntervalSince1970: 1_893_455_998) },
      onResult: { _ in }
    )
    await model.prepare()

    var projection = model.accessibilityProjection()
    XCTAssertEqual(projection.direction, .rightToLeft)
    XCTAssertEqual(
      projection.elements.first { $0.id == "show-offer-details" }?.role,
      .switchControl
    )
    XCTAssertEqual(
      projection.elements.first { $0.id == "offer-highlights" }?.value,
      "التحديثات عن بُعد"
    )
    XCTAssertFalse(projection.elements.contains { $0.id == "offer-countdown" })
    XCTAssertTrue(
      projection.elements.first { $0.id == "plans.plans-yearly-plan-card" }?.isSelected == true
    )
    XCTAssertFalse(
      projection.elements.contains { $0.id == "plans-yearly-plan-card-name" }
    )
    XCTAssertEqual(projection.elements.first?.id, "offer")
    let detailsButton = try XCTUnwrap(
      document.allNodes.compactMap { node -> MosaicButtonComponent? in
        guard case .button(let value) = node, value.id == "view-details" else { return nil }
        return value
      }.first)
    XCTAssertEqual(projection.elements.first { $0.id == detailsButton.id }?.role, .button)
    XCTAssertTrue(
      detailsButton.children.allSatisfy { child in
        !projection.elements.contains { $0.id == child.id }
      }
    )

    model.setSwitchValue(false, for: "show-offer-details")
    projection = model.accessibilityProjection()
    XCTAssertFalse(projection.elements.contains { $0.id == "offer-highlights" })
    XCTAssertTrue(projection.elements.contains { $0.id == "offer-countdown" })
  }

  func testCountdownUsesAbsoluteUTCClockAndCompletedLocalizedText() throws {
    let document = try v02Document()
    let countdown = try XCTUnwrap(
      document.allNodes.compactMap { node -> MosaicCountdownComponent? in
        guard case .countdown(let value) = node else { return nil }
        return value
      }.single)

    let before = try XCTUnwrap(ISO8601DateFormatter().date(from: countdown.endsAt))
      .addingTimeInterval(-90_061)
    XCTAssertEqual(
      MosaicCountdownText.resolve(component: countdown, now: before, completedText: "Ended"),
      "1d 1h 1m 1s"
    )
    XCTAssertEqual(
      MosaicCountdownText.resolve(
        component: countdown,
        now: try XCTUnwrap(ISO8601DateFormatter().date(from: countdown.endsAt))
          .addingTimeInterval(1),
        completedText: "Ended"
      ),
      "Ended"
    )
  }

  func testV02RejectsUnknownPropertiesAndMissingUsedCapabilities() throws {
    var object = try v02FixtureObject()
    var screens = try XCTUnwrap(object["screens"] as? [[String: Any]])
    var layout = try XCTUnwrap(screens[0]["layout"] as? [String: Any])
    var content = try XCTUnwrap(layout["content"] as? [String: Any])
    content["prototypeOnly"] = true
    layout["content"] = content
    screens[0]["layout"] = layout
    object["screens"] = screens
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object)))

    object = try v02FixtureObject()
    var compatibility = try XCTUnwrap(object["compatibility"] as? [String: Any])
    var capabilities = try XCTUnwrap(compatibility["requiredCapabilities"] as? [[String: Any]])
    capabilities.removeAll { $0["name"] as? String == "component.carousel" }
    compatibility["requiredCapabilities"] = capabilities
    object["compatibility"] = compatibility
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object)))
  }

  func testExplicitAlwaysVisibilityRequiresItsAuthoredCapability() throws {
    var object = try XCTUnwrap(
      replacingAllVisibilityWithAlways(in: try v02FixtureObject()) as? [String: Any]
    )
    var compatibility = try XCTUnwrap(object["compatibility"] as? [String: Any])
    var capabilities = try XCTUnwrap(compatibility["requiredCapabilities"] as? [[String: Any]])
    capabilities.removeAll { $0["name"] as? String == "condition.switchVisibility" }
    compatibility["requiredCapabilities"] = capabilities
    object["compatibility"] = compatibility
    XCTAssertNoThrow(try MosaicProtocolDecoder.decode(encoded(object)))

    capabilities.removeAll { $0["name"] as? String == "visibility.static" }
    compatibility["requiredCapabilities"] = capabilities
    object["compatibility"] = compatibility
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_missing_capability_visibility.static")
      )
    }
  }

  func testNavigationPushPopPreservesComponentStateAndRootBackDiagnosesNoOp() throws {
    let document = try v02Document()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(),
      onResult: { _ in }
    )
    let navigate = try button(in: document, id: "view-details")
    let back = try button(in: document, id: "details-back")
    let offerSwitch = try XCTUnwrap(document.switches.first)
    let carousel = try XCTUnwrap(document.carousels.first)

    model.setSwitchValue(false, for: offerSwitch.id)
    model.setCarouselPageIndex(0, for: carousel.id)
    model.performSynchronousAction(using: navigate)

    XCTAssertEqual(model.currentScreenID, "details")
    XCTAssertEqual(model.navigationHistory, ["offer", "details"])
    XCTAssertEqual(model.baseScreen?.id, "offer")
    XCTAssertEqual(model.presentedSheet?.id, "details")
    XCTAssertFalse(model.switchValue(for: offerSwitch.id))
    XCTAssertEqual(model.carouselPageIndex(for: carousel.id), 0)

    model.performSynchronousAction(using: back)
    XCTAssertEqual(model.currentScreenID, "offer")
    XCTAssertEqual(model.navigationHistory, ["offer"])
    XCTAssertEqual(model.baseScreen?.id, "offer")
    XCTAssertNil(model.presentedSheet)
    model.navigateBack()
    XCTAssertEqual(model.navigationHistory, ["offer"])
    XCTAssertEqual(model.diagnostics.last?.code, "navigation_back_at_root")

    model.recordExternalURLOpenResult(false)
    XCTAssertEqual(model.currentScreenID, "offer")
    XCTAssertEqual(model.diagnostics.last?.code, "external_url_open_failed")

    model.performSynchronousAction(using: navigate)
    let acceptedRevisionModel = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(),
      onResult: { _ in }
    )
    XCTAssertEqual(acceptedRevisionModel.navigationHistory, ["offer"])
  }

  func testButtonsRejectInteractiveDescendantsUnsafeProgressAndNavigationCycles() throws {
    var object = try v02FixtureObject()
    try mutateFirstV02Node(type: "button", in: &object) { button in
      var children = button["children"] as? [[String: Any]] ?? []
      children.append(button)
      button["children"] = children
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_interactive_button_descendant")
      )
    }

    object = try v02FixtureObject()
    try mutateFirstV02Node(type: "button", in: &object) { button in
      button["inProgressChildren"] = (button["children"] as? [[String: Any]])?.map { child in
        var child = child
        child["id"] = "\(child["id"] as? String ?? "progress")-progress-test"
        return child
      }
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_progress_content_requires_async_action")
      )
    }

    object = try v02FixtureObject()
    try mutateFirstV02Node(type: "button", in: &object) { button in
      guard (button["action"] as? [String: Any])?["type"] as? String == "close" else { return }
      button["action"] = ["type": "navigateTo", "screenId": "offer"]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object)))
  }

  func testFocusedRC3InvalidFixturesFailClosed() throws {
    for name in [
      "invalid/duplicate-product-reference.json",
      "invalid/incomplete-product-card-default.json",
      "invalid/insecure-external-url.json",
      "invalid/interactive-button-child.json",
      "invalid/interactive-product-card-child.json",
      "invalid/navigation-cycle.json",
      "invalid/product-card-outside-selector.json",
      "invalid/unsafe-product-template.json",
    ] {
      XCTAssertThrowsError(try MosaicProtocolDecoder.decode(v02FixtureData(named: name)), name)
    }
  }

  func testAuthoredSelectionUsesCardIdentityAndMapsToProviderProduct() async throws {
    let document = try v02Document()
    var interactions: [MosaicInteractionOutcome] = []
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      onInteraction: { interactions.append($0) },
      onResult: { _ in }
    )
    await model.prepare()
    let selector = try XCTUnwrap(document.productSelectors.single)

    XCTAssertEqual(model.selectedProductCardID(for: selector.id), "plans-yearly-plan-card")
    XCTAssertEqual(model.selectedProductReferenceID(for: selector.id), "yearly-plan")

    model.selectProduct(cardID: "plans-monthly-plan-card", in: selector.id)
    XCTAssertEqual(model.selectedProductCardID(for: selector.id), "plans-monthly-plan-card")
    XCTAssertEqual(model.selectedProductReferenceID(for: selector.id), "monthly-plan")
    XCTAssertEqual(
      interactions.last,
      MosaicInteractionOutcome.productSelected(productReferenceID: "monthly-plan")
    )
  }

  func testProductTemplatesInterpolateWhitespaceAfterLocalizationAndFallbackName() async throws {
    XCTAssertEqual(
      MosaicProductTemplate.interpolate(
        "{{  product.name }} — {{ product.price   }}",
        productName: "Mosaic Pro",
        localizedPrice: "$4.99"
      ),
      "Mosaic Pro — $4.99"
    )

    let document = try v02Document()
    let product = MosaicProduct(
      id: "mosaic_pro_monthly",
      title: "",
      localizedPrice: "$7.99"
    )
    let model = MosaicPaywallModel(
      document: document,
      requestedLocale: "ar-EG",
      purchaseProvider: MockMosaicPurchaseProvider(products: [product]),
      onResult: { _ in }
    )
    await model.prepare()
    let selector = try XCTUnwrap(document.productSelectors.single)
    let option = try XCTUnwrap(model.availableOptions(for: selector).single)
    let card = try XCTUnwrap(option.card)
    guard case .node(.text(let name)) = card.children[0] else {
      return XCTFail("Expected authored product-name text")
    }
    XCTAssertEqual(model.localization.resolve(name.value, for: option), "شهري")

    var reusedTemplate = try v02FixtureObject()
    try mutateFirstV02Node(type: "productCard", in: &reusedTemplate) { card in
      guard var children = card["children"] as? [[String: Any]],
        var text = children.first,
        let value = text["value"]
      else { return }
      text["accessibility"] = ["role": "text", "label": value]
      children[0] = text
      card["children"] = children
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(reusedTemplate))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_product_template_outside_card")
      )
    }
  }

  func testMissingOrEmptyPricesRemoveCardsAndFallbackInAuthoredOrder() async throws {
    let document = try v02Document()
    let emptyInitialPrice = MosaicProduct(
      id: "mosaic_pro_yearly",
      title: "Yearly",
      localizedPrice: ""
    )
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(
        products: [.phase1Monthly, emptyInitialPrice]
      ),
      onResult: { _ in }
    )
    await model.prepare()
    let selector = try XCTUnwrap(document.productSelectors.single)

    XCTAssertEqual(model.availableOptions(for: selector).map(\.id), ["plans-monthly-plan-card"])
    XCTAssertEqual(model.selectedProductCardID(for: selector.id), "plans-monthly-plan-card")
    XCTAssertEqual(model.selectedProductReferenceID(for: selector.id), "monthly-plan")
  }

  func testBlankPricePreservesANameOnlyAuthoredCard() async throws {
    var object = try v02FixtureObject()
    try replaceV02LocalizedText(
      nodeID: "plans-monthly-plan-card-price",
      property: "value",
      with: "{{ product.name }}",
      in: &object
    )
    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let blankPrice = MosaicProduct(
      id: "mosaic_pro_monthly",
      title: "Provider Monthly",
      localizedPrice: "  "
    )
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: [blankPrice]),
      onResult: { _ in }
    )
    await model.prepare()
    let selector = try XCTUnwrap(document.productSelectors.single)

    XCTAssertEqual(model.availableOptions(for: selector).map(\.id), ["plans-monthly-plan-card"])
    XCTAssertEqual(model.selectedProductCardID(for: selector.id), "plans-monthly-plan-card")
    XCTAssertTrue(model.isButtonEnabled(try button(in: document, id: "purchase")))
  }

  func testBlankPriceIsRequiredThroughNestedStackDescendants() async throws {
    var object = try v02FixtureObject()
    try mutateV02Node(id: "plans-monthly-plan-card", in: &object) { card in
      guard var children = card["children"] as? [[String: Any]],
        let priceIndex = children.firstIndex(where: {
          $0["id"] as? String == "plans-monthly-plan-card-price"
        })
      else { return }
      let price = children[priceIndex]
      children[priceIndex] = [
        "type": "stack",
        "id": "plans-monthly-plan-price-stack",
        "direction": "vertical",
        "gap": 0,
        "padding": ["top": 0, "start": 0, "bottom": 0, "end": 0],
        "mainAxisDistribution": "start",
        "crossAxisAlignment": "stretch",
        "children": [price],
      ]
      card["children"] = children
    }
    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(
        products: [
          MosaicProduct(id: "mosaic_pro_monthly", title: "Monthly", localizedPrice: "")
        ]
      ),
      onResult: { _ in }
    )
    await model.prepare()

    XCTAssertTrue(
      model.availableOptions(for: try XCTUnwrap(document.productSelectors.single)).isEmpty
    )
  }

  func testPriceDependencyUsesTheResolvedBadgeLocaleOnly() async throws {
    var object = try v02FixtureObject()
    try replaceV02LocalizedText(
      nodeID: "plans-yearly-plan-card-price",
      property: "value",
      with: "{{ product.name }}",
      in: &object
    )
    try replaceV02Translation(
      localizationKey: "paywall.products.best_value",
      locale: "ar",
      with: "{{ product.price }}",
      in: &object
    )
    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let product = MosaicProduct(
      id: "mosaic_pro_yearly", title: "Yearly", localizedPrice: ""
    )
    let englishModel = MosaicPaywallModel(
      document: document,
      requestedLocale: "en",
      purchaseProvider: MockMosaicPurchaseProvider(products: [product]),
      onResult: { _ in }
    )
    await englishModel.prepare()
    let selector = try XCTUnwrap(document.productSelectors.single)
    XCTAssertEqual(
      englishModel.availableOptions(for: selector).map(\.id),
      ["plans-yearly-plan-card"],
      "A price template in an inactive locale must not hide a name-only active-locale card."
    )

    let arabicModel = MosaicPaywallModel(
      document: document,
      requestedLocale: "ar-EG",
      purchaseProvider: MockMosaicPurchaseProvider(products: [product]),
      onResult: { _ in }
    )
    await arabicModel.prepare()
    XCTAssertTrue(arabicModel.availableOptions(for: selector).isEmpty)
  }

  func testBlankPriceIsRequiredByCardAccessibilityTemplate() async throws {
    var object = try v02FixtureObject()
    try replaceV02LocalizedText(
      nodeID: "plans-lifetime-plan-card-price",
      property: "value",
      with: "{{ product.name }}",
      in: &object
    )
    let document = try MosaicProtocolDecoder.decode(encoded(object))
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(
        products: [
          MosaicProduct(id: "mosaic_pro_lifetime", title: "Lifetime", localizedPrice: "")
        ]
      ),
      onResult: { _ in }
    )
    await model.prepare()

    XCTAssertTrue(
      model.availableOptions(for: try XCTUnwrap(document.productSelectors.single)).isEmpty
    )
  }

  func testOpenExternalURLRequiresSafeAbsoluteHTTPS() throws {
    let source = try String(decoding: v02FixtureData(), as: UTF8.self)
    let original = #""https://example.com/privacy""#
    XCTAssertTrue(source.contains(original))

    func jsonString(_ value: String) throws -> String {
      try XCTUnwrap(String(data: JSONEncoder().encode(value), encoding: .utf8))
        .replacingOccurrences(of: "\\/", with: "/")
    }

    for unsafe in [
      "http://example.com/privacy",
      "https://user@example.com/privacy",
      "https://例え.テスト/privacy",
      "https://example.com\\@evil.example/privacy",
      "https://example.com:70000/privacy",
    ] {
      let replacement = try jsonString(unsafe)
      let mutated = source.replacingOccurrences(of: original, with: replacement)
      XCTAssertThrowsError(try MosaicProtocolDecoder.decode(mutated), unsafe)
    }

    let punycode = try jsonString("https://xn--r8jz45g.xn--zckzah/privacy")
    XCTAssertNoThrow(
      try MosaicProtocolDecoder.decode(
        source.replacingOccurrences(of: original, with: punycode)
      )
    )
  }

  func testHiddenPurchaseSelectorDisablesItsButtonAndEmitsSafeRuntimeDiagnostic() throws {
    let document = try v02Document(named: "hidden-purchase-target.json")
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      onResult: { _ in }
    )
    let purchase = try button(in: document, id: "purchase")

    XCTAssertFalse(model.isButtonEnabled(purchase))
    XCTAssertEqual(model.diagnostics.last?.code, "purchase_hidden_product_selector")
  }

  func testLocalPreviewV02CodecIsExactAndCarriesTheV02DraftUnchanged() throws {
    let codec = MosaicPreviewMessageCodec(protocolVersion: mosaicLocalPreviewProtocolVersionV02)
    let messages = try localPreviewV02Objects()
    var decodedDraft: MosaicPreviewDraftUpdate?
    for message in messages {
      let data = try JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
      let decoded = try codec.decode(data, expectedSessionId: "session_phase2_demo")
      if case .draftUpdated(let draft) = decoded.message { decodedDraft = draft }
    }

    let draft = try XCTUnwrap(decodedDraft)
    XCTAssertEqual(try MosaicProtocolDecoder.decode(draft.documentData).schemaVersion, "0.2")
    XCTAssertThrowsError(
      try MosaicPreviewMessageCodec().decode(
        try JSONSerialization.data(withJSONObject: messages[0], options: [.sortedKeys])
      )
    ) { error in
      XCTAssertEqual(error as? MosaicPreviewProtocolError, .unsupportedVersion)
    }
  }

  func testLocalPreviewV02CapabilityReportAdvertisesExactImplementedCoverage() throws {
    let codec = MosaicPreviewMessageCodec(protocolVersion: mosaicLocalPreviewProtocolVersionV02)
    let report = MosaicPreviewCapabilityReport.v02(clientId: "client_ios_tests")
    let source = try codec.encode(
      .capabilityReport(report),
      messageId: "msg_ios_v02_report",
      sessionId: "session_phase2_demo",
      sentAt: Date(timeIntervalSince1970: 1_768_665_600)
    )
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(source.utf8)) as? [String: Any]
    )
    XCTAssertEqual(object["previewProtocolVersion"] as? String, "0.2")
    let payload = try XCTUnwrap(object["payload"] as? [String: Any])
    XCTAssertEqual(payload["supportedSchemaVersions"] as? [String], ["0.1", "0.2"])
    let capabilities = try XCTUnwrap(payload["supportedCapabilities"] as? [[String: Any]])
    XCTAssertEqual(
      Set(capabilities.compactMap { $0["name"] as? String }),
      Set(MosaicCapabilityCatalog.v02.map(\.rawValue))
    )
    let preview = try XCTUnwrap(payload["previewCapabilities"] as? [[String: Any]])
    XCTAssertTrue(preview.allSatisfy { $0["version"] as? String == "0.2" })
  }
}

private func button(in document: MosaicPaywallDocument, id: String) throws -> MosaicButtonComponent
{
  for node in document.allNodes {
    if case .button(let button) = node, button.id == id { return button }
  }
  throw CanonicalFixtureLookupError.invalidShape
}

private func v02FixtureObject() throws -> [String: Any] {
  guard let object = try JSONSerialization.jsonObject(with: v02FixtureData()) as? [String: Any]
  else { throw CanonicalFixtureLookupError.invalidShape }
  return object
}

private func replaceV02LocalizedText(
  nodeID: String,
  property: String,
  with value: String,
  in object: inout [String: Any]
) throws {
  var localizationKey: String?
  try mutateV02Node(id: nodeID, in: &object) { node in
    guard var text = node[property] as? [String: Any],
      let key = text["localizationKey"] as? String
    else { return }
    localizationKey = key
    text["default"] = value
    node[property] = text
  }
  guard let localizationKey else { throw CanonicalFixtureLookupError.invalidShape }
  var localization = try XCTUnwrap(object["localization"] as? [String: Any])
  var locales = try XCTUnwrap(localization["locales"] as? [String: Any])
  for locale in locales.keys {
    guard var catalog = locales[locale] as? [String: Any],
      var strings = catalog["strings"] as? [String: Any],
      strings[localizationKey] != nil
    else { continue }
    strings[localizationKey] = value
    catalog["strings"] = strings
    locales[locale] = catalog
  }
  localization["locales"] = locales
  object["localization"] = localization
}

private func replaceV02Translation(
  localizationKey: String,
  locale: String,
  with value: String,
  in object: inout [String: Any]
) throws {
  var localization = try XCTUnwrap(object["localization"] as? [String: Any])
  var locales = try XCTUnwrap(localization["locales"] as? [String: Any])
  var catalog = try XCTUnwrap(locales[locale] as? [String: Any])
  var strings = try XCTUnwrap(catalog["strings"] as? [String: Any])
  guard strings[localizationKey] != nil else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  strings[localizationKey] = value
  catalog["strings"] = strings
  locales[locale] = catalog
  localization["locales"] = locales
  object["localization"] = localization
}

private func replacingAllVisibilityWithAlways(in value: Any) -> Any {
  if let values = value as? [Any] {
    return values.map(replacingAllVisibilityWithAlways)
  }
  guard var object = value as? [String: Any] else { return value }
  for (key, nested) in object where key != "visibility" {
    object[key] = replacingAllVisibilityWithAlways(in: nested)
  }
  if object["visibility"] != nil {
    object["visibility"] = ["mode": "always"]
  }
  return object
}

private func localPreviewV02Objects() throws -> [[String: Any]] {
  let manager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate = directory.appendingPathComponent(
      "protocol/fixtures/local-preview/v0.2/session-flow.messages.json"
    )
    if manager.fileExists(atPath: candidate.path) {
      guard
        let values = try JSONSerialization.jsonObject(
          with: Data(contentsOf: candidate)
        ) as? [[String: Any]]
      else { throw CanonicalFixtureLookupError.invalidShape }
      return values
    }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

extension Collection {
  fileprivate var single: Element? { count == 1 ? first : nil }
}
